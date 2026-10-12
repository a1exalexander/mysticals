import { chmodSync, mkdirSync, rmSync } from 'fs'
import { createConnection, createServer, type Server, type Socket } from 'net'
import { Cause, Context, Deferred, Effect, Exit, FiberHandle, FiberSet, Layer, Scope } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { createApi, type CoreApiEffect } from '@mysticals/core/api'
import { AccountStore, SecretCrypto } from '@mysticals/core/accounts/store'
import { messageOf } from '@mysticals/core/errors'
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
}

export interface ServeOptions {
  /** Idle time after the last client leaves (or none ever came) before onIdle. Default 3 s. */
  graceMs?: number
  onIdle(): void
  /** A TUI connected (e.g. sync so it opens on fresh data). */
  onConnect?(): void
}

/** The socket is taken by another daemon that still answers (`code` mirrors Node's for callers and tests). */
export class AddressInUse extends Error {
  readonly code = 'EADDRINUSE'
}

/** True when a live daemon answers on `path`. */
const alive = (path: string): Effect.Effect<boolean> =>
  Effect.callback((resume) => {
    const s = createConnection(path)
    s.once('connect', () => (s.destroy(), resume(Effect.succeed(true))))
    s.once('error', () => resume(Effect.succeed(false)))
  })

const listen = (server: Server, path: string): Effect.Effect<void, NodeJS.ErrnoException> =>
  Effect.callback((resume) => {
    const failed = (e: NodeJS.ErrnoException): void => resume(Effect.fail(e))
    server.once('error', failed)
    server.listen(path, () => {
      server.off('error', failed)
      resume(Effect.void)
    })
  })

/**
 * Serves `api` on a unix socket and counts clients; `onIdle` fires once nobody has been connected for `graceMs`.
 * Fails with AddressInUse when another live daemon already owns the socket. Closing the scope disconnects every
 * client, stops the server and interrupts calls still running.
 */
export const serve = (api: ApiImpl, path: string, opts: ServeOptions): Effect.Effect<Daemon, AddressInUse | NodeJS.ErrnoException, Scope.Scope> =>
  Effect.gen(function* () {
    const clients = new Set<Socket>()
    // Socket callbacks run effects (calls, the idle timer) as fibers of this scope.
    const run = yield* FiberSet.makeRuntime<never, unknown, unknown>()
    const idle = yield* FiberHandle.make()
    const armIdle = (): void =>
      void run(FiberHandle.run(idle, Effect.sleep(opts.graceMs ?? 3000).pipe(Effect.andThen(Effect.sync(opts.onIdle)))))
    const disarm = (): void => void run(FiberHandle.clear(idle))

    /** One call: its result, or its failure's message (typed error, schema error or defect). */
    const answer = (id: number, method: Parameters<typeof dispatch>[1], params: unknown[]): Effect.Effect<Response> =>
      Effect.map(Effect.exit(dispatch(api, method, params)), (exit) =>
        Exit.isSuccess(exit) ? { id, result: exit.value } : { id, error: messageOf(Cause.squash(exit.cause)) }
      )

    const server = createServer((sock) => {
      clients.add(sock)
      disarm()
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
          run(Effect.map(answer(id, method, Array.isArray(params) ? params : []), send))
        })
      )
      sock.on('error', () => sock.destroy())
      sock.on('close', () => {
        clients.delete(sock)
        if (clients.size === 0) armIdle()
      })
    })

    yield* Effect.acquireRelease(
      listen(server, path).pipe(
        Effect.catch((e) =>
          Effect.gen(function* () {
            if (e.code !== 'EADDRINUSE') return yield* Effect.fail(e)
            if (yield* alive(path)) return yield* Effect.fail(new AddressInUse(`Another daemon owns ${path}`))
            // Stale socket from a crashed daemon.
            // ponytail: two daemons racing on the same stale file can both unlink+bind; a lock file closes that gap if it bites.
            if (process.platform !== 'win32') rmSync(path, { force: true }) // named pipes vanish with their owner
            yield* listen(server, path)
          })
        )
      ),
      () =>
        Effect.callback<void>((resume) => {
          for (const c of clients) c.destroy()
          server.close(() => resume(Effect.void))
        })
    )
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
      clientCount: () => clients.size
    }
  })

/** `mysticals --daemon`: owns accounts, sync and notifications for every open TUI; exits when the last one closes. */
export const runDaemon: Effect.Effect<void, unknown> = Effect.scoped(
  Effect.gen(function* () {
    const home = homeDir()
    mkdirSync(home, { recursive: true, mode: 0o700 })
    let broadcast = (_accountId: string): void => {}
    let push = (_msg: Push): void => {}
    const stopped = yield* Deferred.make<void>()
    const scope = yield* Effect.scope

    let api: CoreApiEffect
    let sync: (typeof SyncEngine)['Service'] | undefined
    if (isMock()) {
      api = createMockApi((id) => broadcast(id))
    } else {
      setClientConfig(googleConfig()) // also needed for token refresh, not just sign-in
      // TUIs show the URL (and its loopback port, for ssh -L) when no browser opens; a failed launch must not abort sign-in.
      // ponytail: goes to every TUI, so two concurrent sign-ins may see each other's URL; target the caller if that bites.
      const signInBrowser = (url: string): Promise<void> => (push({ event: 'authUrl', url }), openUrl(url).catch(() => {}))
      const factories = { caldav: createCaldavProvider, google: createGoogleProvider }
      const storeLayer = AccountStore.layer(home, factories).pipe(
        Layer.provide(Layer.mergeAll(NodeFileSystem.layer, Layer.succeed(SecretCrypto, createCrypto(undefined, home))))
      )
      // ponytail: env opt-outs are read when the daemon starts, i.e. from the TUI that spawned it; windows opened while it
      // runs share it. Forward each client's opt-out over the socket if that ever matters (README says so for now).
      const track = (yield* telemetry().pipe(Effect.provide(NodeFileSystem.layer)))?.track
      let store: (typeof AccountStore)['Service'] | undefined
      const backend = Layer.provideMerge(
        SyncEngine.layer((id) => broadcast(id), {
          triggers: wakeTriggers(),
          onEvents: (id, notes) => void (store && Effect.runFork(notify(store, id, notes))),
          onSyncing: (id) => broadcast(id) // clients re-read accounts.list for the `syncing` flag
        }),
        storeLayer
      )
      const services = yield* Layer.buildWithScope(backend, scope)
      store = Context.get(services, AccountStore)
      sync = Context.get(services, SyncEngine)
      api = yield* createApi({
        verifyCaldav,
        googleSignIn: () => googleSignIn(signInBrowser),
        onChanged: (id) => broadcast(id),
        onAccountAdded: (info) => track?.('account_added', info)
      }).pipe(Effect.provide(services))
    }

    const daemon = yield* serve(api, socketPath(home), {
      onIdle: () => void Effect.runFork(Deferred.succeed(stopped, undefined)),
      onConnect: () => void (sync && Effect.runFork(Effect.ignore(sync.syncNow())))
    }).pipe(
      // Another daemon won the race: it serves the TUIs.
      Effect.catchIf((e) => e instanceof AddressInUse, () => Deferred.succeed(stopped, undefined).pipe(Effect.as(undefined)))
    )
    if (!daemon) return
    broadcast = daemon.broadcast
    push = daemon.push
    if (sync) yield* sync.start
    // Runs until idle; SIGTERM/SIGINT interrupt it (see cli), and closing the scope stops sync and the socket.
    yield* Deferred.await(stopped)
  })
)
