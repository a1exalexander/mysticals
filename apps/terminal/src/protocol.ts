import { StringDecoder } from 'string_decoder'
import type { Api } from '@mysticals/core/shared/ipc'

/**
 * Daemon <-> TUI wire format: newline-delimited JSON over a unix socket.
 * Client -> daemon: Request. Daemon -> client: Response (matched by id) or Push (unsolicited).
 */
export interface Request {
  id: number
  method: Method
  params: unknown[]
}
export type Response = { id: number; result?: unknown; error?: string }
export type Push = { event: 'changed'; accountId: string }

/** The backend slice of Api served by the daemon (onChanged is a Push, onMenu is desktop-only). */
export type ApiImpl = Omit<Api, 'onChanged' | 'onMenu'>

type Paths<T> = { [G in keyof T]: `${G & string}.${keyof T[G] & string}` }[keyof T]
export type Method = Paths<ApiImpl>

// The Record forces this list to cover every Api method at compile time.
const methodSet: Record<Method, true> = {
  'accounts.list': true,
  'accounts.addGoogle': true,
  'accounts.addCaldav': true,
  'accounts.update': true,
  'accounts.remove': true,
  'calendars.list': true,
  'calendars.setVisible': true,
  'events.list': true,
  'events.create': true,
  'events.update': true,
  'events.delete': true,
  'events.respond': true,
  'sync.now': true
}
export const METHODS = Object.keys(methodSet) as Method[]
export const isMethod = (m: unknown): m is Method => typeof m === 'string' && Object.hasOwn(methodSet, m)

export const encode = (msg: Request | Response | Push): string => JSON.stringify(msg) + '\n'

/** Returns a chunk handler that emits each complete JSON line; malformed lines go to onBad. */
export function lineReader(onMessage: (msg: unknown) => void, onBad: (line: string) => void = () => {}): (chunk: Buffer | string) => void {
  let buf = ''
  const utf8 = new StringDecoder('utf8') // keeps multi-byte chars split across chunks intact
  return (chunk) => {
    buf += typeof chunk === 'string' ? chunk : utf8.write(chunk)
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      let msg: unknown
      try {
        msg = JSON.parse(line)
      } catch {
        onBad(line)
        continue
      }
      onMessage(msg)
    }
  }
}

/** Calls `method` on an ApiImpl. Only whitelisted names get here, so no prototype lookups. */
export function dispatch(api: ApiImpl, method: Method, params: unknown[]): Promise<unknown> {
  const [group, fn] = method.split('.') as [keyof ApiImpl, string]
  const target = api[group] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
  return target[fn](...params)
}
