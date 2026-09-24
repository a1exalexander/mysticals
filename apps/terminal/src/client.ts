import { spawn } from 'child_process'
import { mkdirSync, openSync } from 'fs'
import { createConnection, type Socket } from 'net'
import { join } from 'path'
import { fileURLToPath } from 'url'
import type { Api } from '@mysticals/core/shared/ipc'
import { homeDir, socketPath } from './paths'
import { encode, lineReader, METHODS, type Method, type Push, type Response } from './protocol'

/** What the TUI talks to: the daemon's Api plus change pushes. */
export type ClientApi = Omit<Api, 'onMenu'> & {
  /** Disconnects; the daemon exits a few seconds after its last client leaves. */
  close(): void
}

const connectOnce = (path: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = createConnection(path)
    s.once('connect', () => {
      s.off('error', reject)
      resolve(s)
    })
    s.once('error', reject)
  })

/** Starts `node dist/cli.js --daemon` detached, logging to <home>/daemon.log. */
export function spawnDaemon(): void {
  const home = homeDir()
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const log = openSync(join(home, 'daemon.log'), 'a', 0o600)
  const cli = fileURLToPath(import.meta.url) // the bundled dist/cli.js
  spawn(process.execPath, [cli, '--daemon'], { detached: true, stdio: ['ignore', log, log], env: process.env }).unref()
}

/** Connects to the daemon on `path`, starting one via `start` if none answers. */
export async function dial(path = socketPath(), start = spawnDaemon): Promise<Socket> {
  try {
    return await connectOnce(path)
  } catch {
    start()
  }
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      return await connectOnce(path)
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`Could not start the mysticals daemon (see ${join(homeDir(), 'daemon.log')})`, { cause: e })
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

/**
 * Api over the daemon socket from `open`. When the socket drops (daemon crashed or shut down under us), in-flight
 * calls reject, onChanged listeners fire with '' so screens reload, and the next call dials again.
 */
export function clientFor(open: () => Promise<Socket>): ClientApi {
  let seq = 0
  let current: Promise<Socket> | undefined
  let closed = false
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  const listeners = new Set<(accountId: string) => void>()
  const emit = (accountId: string): void => listeners.forEach((l) => l(accountId))

  const attach = (sock: Socket): Socket => {
    sock.on(
      'data',
      lineReader((msg) => {
        const m = msg as Response & Partial<Push>
        if (m.event === 'changed' && typeof m.accountId === 'string') return emit(m.accountId)
        const p = pending.get(m.id)
        if (!p) return
        pending.delete(m.id)
        if (m.error !== undefined) p.reject(new Error(m.error))
        else p.resolve(m.result)
      })
    )
    sock.on('error', () => {}) // surfaced through 'close'
    sock.on('close', () => {
      current = undefined
      for (const p of pending.values()) p.reject(new Error('Lost connection to the mysticals daemon'))
      pending.clear()
      if (!closed) emit('')
    })
    return sock
  }

  const socket = (): Promise<Socket> => {
    if (closed) return Promise.reject(new Error('Client closed'))
    current ??= open().then(attach, (e: unknown) => {
      current = undefined
      throw e
    })
    return current
  }

  const call = async (method: Method, params: unknown[]): Promise<unknown> => {
    const sock = await socket()
    return new Promise((resolve, reject) => {
      if (sock.destroyed) return reject(new Error('Lost connection to the mysticals daemon'))
      const id = ++seq
      pending.set(id, { resolve, reject })
      sock.write(encode({ id, method, params }))
    })
  }

  const api: Record<string, Record<string, unknown>> = {}
  for (const m of METHODS) {
    const [group, fn] = m.split('.')
    api[group] ??= {}
    api[group][fn] = (...params: unknown[]) => call(m, params)
  }
  return Object.assign(api as unknown as Omit<Api, 'onChanged' | 'onMenu'>, {
    onChanged(cb: (accountId: string) => void) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    close() {
      closed = true
      void current?.then((s) => s.end())
    }
  })
}

/** Connects to the shared daemon (starting one if none is running); reconnects the same way after a drop. */
export async function connect(path = socketPath(), start = spawnDaemon): Promise<ClientApi> {
  const client = clientFor(() => dial(path, start))
  await client.accounts.list() // fail fast at startup if the daemon can't be reached
  return client
}
