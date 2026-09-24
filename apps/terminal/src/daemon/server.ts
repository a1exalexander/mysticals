import { chmodSync, mkdirSync, rmSync } from 'fs'
import { createConnection, createServer, type Server, type Socket } from 'net'
import { createApi } from '@mysticals/core/api'
import { AccountStore } from '@mysticals/core/accounts/store'
import { createMockApi } from '@mysticals/core/mock/mockApi'
import { createCaldavProvider, verifyCaldav } from '@mysticals/core/providers/caldav'
import { createGoogleProvider, googleSignIn, setClientConfig } from '@mysticals/core/providers/google'
import { SyncEngine } from '@mysticals/core/sync/engine'
import { homeDir, isMock, socketPath } from '../paths'
import { telemetry } from '../telemetry'
import { dispatch, encode, isMethod, lineReader, type ApiImpl, type Push, type Response } from '../protocol'
import { createCrypto } from './crypto'
import { googleConfig, openUrl } from './google'
import { notify } from './notify'
import { wakeTriggers } from './triggers'

export interface Daemon {
  server: Server
  /** Pushes `changed` to every connected TUI. */
  broadcast(accountId: string): void
  /** Pushes `msg` to every connected TUI. */
  push(msg: Push): void
  clientCount(): number
  close(): Promise<void>
}

export interface ServeOptions {
  /** Idle time after the last client leaves (or none ever came) before onIdle. Default 3 s. */
  graceMs?: number
  onIdle(): void
  /** A TUI connected (e.g. sync so it opens on fresh data). */
  onConnect?(): void
}

/** True when a live daemon answers on `path`. */
const alive = (path: string): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createConnection(path)
    s.once('connect', () => (s.destroy(), resolve(true)))
    s.once('error', () => resolve(false))
  })

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

/**
 * Serves `api` on a unix socket and counts clients; `onIdle` fires once nobody has been connected for `graceMs`.
 * Rejects with code 'EADDRINUSE' when another live daemon already owns the socket.
 */
export async function serve(api: ApiImpl, path: string, opts: ServeOptions): Promise<Daemon> {
  const clients = new Set<Socket>()
  let idle: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    clearTimeout(idle)
    idle = setTimeout(opts.onIdle, opts.graceMs ?? 3000)
  }

  const server = createServer((sock) => {
    clients.add(sock)
    clearTimeout(idle)
    opts.onConnect?.()
    const send = (msg: Response | Push): void => {
      if (!sock.destroyed) sock.write(encode(msg))
    }
    sock.on(
      'data',
      lineReader((msg) => {
        const { id, method, params } = (msg ?? {}) as { id?: unknown; method?: unknown; params?: unknown }
        if (typeof id !== 'number') return
        if (!isMethod(method)) return send({ id, error: `Unknown method: ${String(method)}` })
        dispatch(api, method, Array.isArray(params) ? params : []).then(
          (result) => send({ id, result }),
          (e: unknown) => send({ id, error: e instanceof Error ? e.message : String(e) })
        )
      })
    )
    sock.on('error', () => sock.destroy())
    sock.on('close', () => {
      clients.delete(sock)
      if (clients.size === 0) armIdle()
    })
  })

  try {
    await listen(server, path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || (await alive(path))) throw e
    // Stale socket from a crashed daemon.
    // ponytail: two daemons racing on the same stale file can both unlink+bind; a lock file closes that gap if it bites.
    if (process.platform !== 'win32') rmSync(path, { force: true }) // named pipes vanish with their owner
    await listen(server, path)
  }
  server.on('error', (e) => console.error('daemon socket error', e))
  // Named pipes (Windows) are not files; their default ACL already limits them to the current user.
  if (process.platform !== 'win32') chmodSync(path, 0o600)
  armIdle()

  const push = (msg: Push): void => {
    const line = encode(msg)
    for (const c of clients) if (!c.destroyed) c.write(line)
  }
  return {
    server,
    push,
    broadcast: (accountId) => push({ event: 'changed', accountId }),
    clientCount: () => clients.size,
    close: () =>
      new Promise((resolve) => {
        clearTimeout(idle)
        for (const c of clients) c.destroy()
        server.close(() => resolve())
      })
  }
}

/** `mysticals --daemon`: owns accounts, sync and notifications for every open TUI; exits when the last one closes. */
export async function runDaemon(): Promise<void> {
  const home = homeDir()
  mkdirSync(home, { recursive: true, mode: 0o700 })
  let broadcast = (_accountId: string): void => {}
  let push = (_msg: Push): void => {}
  let sync: SyncEngine | undefined
  let api: ApiImpl
  if (isMock()) {
    api = createMockApi((id) => broadcast(id))
  } else {
    setClientConfig(googleConfig()) // also needed for token refresh, not just sign-in
    // TUIs show the URL (and its loopback port, for ssh -L) when no browser opens; a failed launch must not abort sign-in.
    // ponytail: goes to every TUI, so two concurrent sign-ins may see each other's URL; target the caller if that bites.
    const signInBrowser = (url: string): Promise<void> => (push({ event: 'authUrl', url }), openUrl(url).catch(() => {}))
    const factories = { caldav: createCaldavProvider, google: createGoogleProvider }
    const store = new AccountStore(home, factories, createCrypto(undefined, home))
    sync = new SyncEngine(store, (id) => broadcast(id), {
      triggers: wakeTriggers(),
      onEvents: (id, notes) => notify(store, id, notes),
      onSyncing: (id) => broadcast(id) // clients re-read accounts.list for the `syncing` flag
    })
    // ponytail: env opt-outs are read when the daemon starts, i.e. from the TUI that spawned it; windows opened while it
    // runs share it. Forward each client's opt-out over the socket if that ever matters (README says so for now).
    const track = telemetry()?.track
    api = createApi(store, sync, {
      verifyCaldav,
      googleSignIn: () => googleSignIn(signInBrowser),
      onChanged: (id) => broadcast(id),
      onAccountAdded: (info) => track?.('account_added', info)
    })
  }

  let daemon: Daemon
  const shutdown = async (): Promise<void> => {
    sync?.stop()
    await daemon?.close()
    process.exit(0)
  }
  try {
    daemon = await serve(api, socketPath(home), { onIdle: () => void shutdown(), onConnect: () => void sync?.syncNow() })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') process.exit(0) // another daemon won the race
    throw e
  }
  broadcast = daemon.broadcast
  push = daemon.push
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
  sync?.start()
}
