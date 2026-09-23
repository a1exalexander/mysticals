import { chmodSync, mkdirSync, rmSync } from 'fs'
import { createConnection, createServer, type Server, type Socket } from 'net'
import { execFile } from 'child_process'
import { createApi } from '@multicals/core/api'
import { AccountStore } from '@multicals/core/accounts/store'
import { createMockApi } from '@multicals/core/mock/mockApi'
import { createCaldavProvider, verifyCaldav } from '@multicals/core/providers/caldav'
import { createGoogleProvider, googleSignIn } from '@multicals/core/providers/google'
import { SyncEngine } from '@multicals/core/sync/engine'
import { homeDir, isMock, socketPath } from '../paths'
import { dispatch, encode, isMethod, lineReader, type ApiImpl, type Push, type Response } from '../protocol'
import { createCrypto } from './crypto'
import { notify } from './notify'

export interface Daemon {
  server: Server
  /** Pushes `changed` to every connected TUI. */
  broadcast(accountId: string): void
  clientCount(): number
  close(): Promise<void>
}

export interface ServeOptions {
  /** Idle time after the last client leaves (or none ever came) before onIdle. Default 3 s. */
  graceMs?: number
  onIdle(): void
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
    rmSync(path, { force: true })
    await listen(server, path)
  }
  server.on('error', (e) => console.error('daemon socket error', e))
  chmodSync(path, 0o600)
  armIdle()

  return {
    server,
    broadcast: (accountId) => {
      const line = encode({ event: 'changed', accountId })
      for (const c of clients) if (!c.destroyed) c.write(line)
    },
    clientCount: () => clients.size,
    close: () =>
      new Promise((resolve) => {
        clearTimeout(idle)
        for (const c of clients) c.destroy()
        server.close(() => resolve())
      })
  }
}

/** `multicals --daemon`: owns accounts, sync and notifications for every open TUI; exits when the last one closes. */
export async function runDaemon(): Promise<void> {
  const home = homeDir()
  mkdirSync(home, { recursive: true, mode: 0o700 })
  let broadcast = (_accountId: string): void => {}
  let sync: SyncEngine | undefined
  let api: ApiImpl
  if (isMock()) {
    api = createMockApi((id) => broadcast(id))
  } else {
    // Unit 6: setClientConfig({ clientId, clientSecret }) from build-time MULTICALS_GOOGLE_* here.
    const factories = { caldav: createCaldavProvider, google: createGoogleProvider }
    const store = new AccountStore(home, factories, createCrypto())
    // Unit 6: pass `triggers` (wake from sleep) here.
    sync = new SyncEngine(store, (id) => broadcast(id), { onEvents: (id, notes) => notify(store, id, notes) })
    const openUrl = (url: string): Promise<void> =>
      new Promise((resolve, reject) => execFile('open', [url], (e) => (e ? reject(e) : resolve())))
    api = createApi(store, sync, { verifyCaldav, googleSignIn: () => googleSignIn(openUrl), onChanged: (id) => broadcast(id) })
  }

  let daemon: Daemon
  const shutdown = async (): Promise<void> => {
    sync?.stop()
    await daemon?.close()
    process.exit(0)
  }
  try {
    daemon = await serve(api, socketPath(home), { onIdle: () => void shutdown() })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') process.exit(0) // another daemon won the race
    throw e
  }
  broadcast = daemon.broadcast
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
  sync?.start()
}
