import { spawn } from 'child_process'
import { mkdirSync, openSync } from 'fs'
import { createConnection, type Socket } from 'net'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { Deferred, Effect, Schedule } from 'effect'
import type { ApiError, CoreApiEffect } from '@mysticals/core/api'
import { AppError, fail, messageOf } from '@mysticals/core/errors'
import { homeDir, socketPath } from './paths'
import { encode, lineReader, METHODS, type Method, type Response } from './protocol'

/** What the TUI talks to: the daemon's Api (as effects) plus change pushes. */
export type ClientApi = CoreApiEffect & {
  /** Fires when cached data of an account changed ('' after a reconnect: reload everything). Returns unsubscribe. */
  onChanged(cb: (accountId: string) => void): () => void
  /** Google sign-in URL, pushed while the daemon waits for the browser (so it can be opened by hand). */
  onAuthUrl(cb: (url: string) => void): () => void
  /** Disconnects; the daemon exits a few seconds after its last client leaves. */
  close(): void
}

/** How long a call may wait for its answer; sign-in and sync wait on the user or on remote servers instead. */
const CALL_TIMEOUT = '1 minute'
const UNBOUNDED = new Set<Method>(['accounts.addGoogle', 'accounts.addCaldav', 'accounts.reauth', 'sync.now'])

const connectOnce = (path: string): Effect.Effect<Socket, AppError> =>
  Effect.callback((resume) => {
    const s = createConnection(path)
    const failed = (e: Error): void => resume(Effect.fail(fail(e.message)))
    s.once('connect', () => {
      s.off('error', failed)
      resume(Effect.succeed(s))
    })
    s.once('error', failed)
  })

/** Starts `node dist/cli.js --daemon` detached, logging to <home>/daemon.log. */
export function spawnDaemon(): void {
  const home = homeDir()
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const log = openSync(join(home, 'daemon.log'), 'a', 0o600)
  const cli = fileURLToPath(import.meta.url) // the bundled dist/cli.js
  // windowsHide: no stray console window for the background daemon on Windows.
  spawn(process.execPath, [cli, '--daemon'], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env }).unref()
}

/** Connects to the daemon on `path`, starting one via `start` if none answers. */
export const dial = (path = socketPath(), start = spawnDaemon): Effect.Effect<Socket, AppError> =>
  connectOnce(path).pipe(
    Effect.catch(() =>
      Effect.sync(start).pipe(
        Effect.andThen(connectOnce(path).pipe(Effect.retry({ schedule: Schedule.spaced('100 millis') }))),
        Effect.timeoutOrElse({
          duration: '10 seconds',
          orElse: () => Effect.fail(fail(`Could not start the mysticals daemon (see ${join(homeDir(), 'daemon.log')})`))
        })
      )
    )
  )

/**
 * Api over the daemon socket from `open`. When the socket drops (daemon crashed or shut down under us), in-flight
 * calls fail, onChanged listeners fire with '' so screens reload, and the next call dials again.
 */
export function clientFor(open: Effect.Effect<Socket, AppError>): ClientApi {
  let seq = 0
  let current: Deferred.Deferred<Socket, AppError> | undefined
  let closed = false
  const pending = new Map<number, (r: Effect.Effect<unknown, AppError>) => void>()
  const listeners = new Set<(accountId: string) => void>()
  const emit = (accountId: string): void => listeners.forEach((l) => l(accountId))
  const authListeners = new Set<(url: string) => void>()

  const attach = (sock: Socket): Socket => {
    sock.on(
      'data',
      lineReader((msg) => {
        const m = msg as Response & { event?: string; accountId?: unknown; url?: unknown }
        if (m.event === 'changed' && typeof m.accountId === 'string') return emit(m.accountId)
        if (m.event === 'authUrl' && typeof m.url === 'string') return authListeners.forEach((l) => l(m.url as string))
        const settle = pending.get(m.id)
        if (!settle) return
        pending.delete(m.id)
        settle(m.error !== undefined ? Effect.fail(fail(m.error)) : Effect.succeed(m.result))
      })
    )
    sock.on('error', () => {}) // surfaced through 'close'
    sock.on('close', () => {
      current = undefined
      for (const settle of pending.values()) settle(Effect.fail(fail('Lost connection to the mysticals daemon')))
      pending.clear()
      if (!closed) emit('')
    })
    return sock
  }

  /** The live socket; concurrent callers share one dial. */
  const socket: Effect.Effect<Socket, AppError> = Effect.suspend(() => {
    if (closed) return Effect.fail(fail('Client closed'))
    if (!current) {
      const dialing = (current = Deferred.makeUnsafe<Socket, AppError>())
      Effect.runFork(
        open.pipe(
          Effect.map(attach),
          Effect.tapError(() => Effect.sync(() => void (current === dialing && (current = undefined)))),
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(dialing, exit))
        )
      )
    }
    return Deferred.await(current)
  })

  const call = (method: Method, params: unknown[]): Effect.Effect<unknown, ApiError> => {
    const sent = Effect.flatMap(socket, (sock) =>
      Effect.callback<unknown, AppError>((resume) => {
        if (sock.destroyed) return resume(Effect.fail(fail('Lost connection to the mysticals daemon')))
        const id = ++seq
        pending.set(id, resume)
        sock.write(encode({ id, method, params }))
        return Effect.sync(() => void pending.delete(id)) // timed out or interrupted: a late answer is dropped
      })
    )
    return UNBOUNDED.has(method)
      ? sent
      : sent.pipe(Effect.timeoutOrElse({ duration: CALL_TIMEOUT, orElse: () => Effect.fail(fail('The mysticals daemon did not answer in time')) }))
  }

  const api: Record<string, Record<string, unknown>> = {}
  for (const m of METHODS) {
    const [group, fn] = m.split('.')
    api[group] ??= {}
    api[group][fn] = (...params: unknown[]) => call(m, params)
  }
  return Object.assign(api as unknown as CoreApiEffect, {
    onChanged(cb: (accountId: string) => void) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    onAuthUrl(cb: (url: string) => void) {
      authListeners.add(cb)
      return () => void authListeners.delete(cb)
    },
    close() {
      closed = true
      const sock = current
      if (sock) Effect.runFork(Effect.flatMap(Deferred.await(sock), (s) => Effect.sync(() => s.end())).pipe(Effect.ignore))
    }
  })
}

/** Connects to the shared daemon (starting one if none is running); reconnects the same way after a drop. */
export const connect = (path = socketPath(), start = spawnDaemon): Effect.Effect<ClientApi, ApiError> =>
  Effect.gen(function* () {
    const client = clientFor(dial(path, start))
    yield* client.accounts.list() // fail fast at startup if the daemon can't be reached
    return client
  })
