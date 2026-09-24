import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountStore } from '@mysticals/core/accounts/store'
import type { Note } from '@mysticals/core/sync/notify'
import { createCrypto, type KeyStore } from './crypto'
import { googleConfig } from './google'
import { notify } from './notify'
import { wakeTriggers } from './triggers'

const memKeys = (): KeyStore & { key?: Buffer } => ({
  get() {
    return this.key
  },
  set(k) {
    this.key = k
  }
})

describe('crypto', () => {
  it('round-trips, creating the master key lazily', () => {
    const keys = memKeys()
    const c = createCrypto(keys)
    expect(keys.key).toBeUndefined()
    const blob = c.encrypt('sëcret')
    expect(keys.key).toHaveLength(32)
    expect(blob[0]).toBe(1)
    expect(blob.toString('utf8')).not.toContain('sëcret')
    expect(createCrypto(keys).decrypt(blob)).toBe('sëcret')
    expect(c.encrypt('sëcret').equals(blob)).toBe(false) // fresh IV
  })

  it('rejects tampered or foreign blobs', () => {
    const c = createCrypto(memKeys())
    const blob = c.encrypt('secret')
    blob[blob.length - 1] ^= 1
    expect(() => c.decrypt(blob)).toThrow()
    expect(() => c.decrypt(Buffer.from([2, ...blob.subarray(1)]))).toThrow('Unsupported credential format')
  })

  it('decrypt without a key fails clearly and does not create one', () => {
    const blob = createCrypto(memKeys()).encrypt('x')
    const empty = memKeys()
    expect(() => createCrypto(empty).decrypt(blob)).toThrow('Master key missing')
    expect(empty.key).toBeUndefined()
  })
})

describe('notify', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('passes text as osascript argv and skips hidden calendars', () => {
    if (process.platform !== 'darwin') return
    vi.stubEnv('MYSTICALS_MOCK', '')
    const store = {
      get: () => ({ id: 'a', label: 'Work "HQ" \\' }),
      hiddenCalendars: () => ['hidden']
    } as unknown as AccountStore
    const ev = (calendarId: string, title: string): Note => ({
      kind: 'invite',
      event: { calendarId, id: title, title, start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z', allDay: false } as Note['event']
    })
    const run = vi.fn()
    notify(store, 'a', [ev('hidden', 'Nope'), ev('cal', 'Say "hi"')], run)
    expect(run).toHaveBeenCalledTimes(1)
    const [file, args] = run.mock.calls[0]
    expect(file).toBe('osascript')
    expect(args.slice(-2)[0]).toBe('New invite: Say "hi"')
    expect(args.slice(-1)[0]).toContain('Work "HQ" \\')
  })
})

describe('wakeTriggers', () => {
  afterEach(() => vi.useRealTimers())

  it('fires only when a tick arrives far later than expected', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const off = wakeTriggers()(fire)
    vi.advanceTimersByTime(90_000)
    expect(fire).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + 5 * 60_000) // asleep: clock jumps, timers didn't run
    vi.advanceTimersByTime(30_000)
    expect(fire).toHaveBeenCalledTimes(1)
    off()
    vi.setSystemTime(Date.now() + 5 * 60_000)
    vi.advanceTimersByTime(30_000)
    expect(fire).toHaveBeenCalledTimes(1)
  })
})

describe('googleConfig', () => {
  const built = { clientId: 'b-id', clientSecret: 'b-secret' }
  it('uses the build-time pair unless runtime env sets a client id', () => {
    expect(googleConfig({}, built)).toEqual(built)
    expect(googleConfig({ MYSTICALS_GOOGLE_CLIENT_ID: 'r-id', MYSTICALS_GOOGLE_CLIENT_SECRET: 'r-s' }, built)).toEqual({
      clientId: 'r-id',
      clientSecret: 'r-s'
    })
    expect(googleConfig({ MYSTICALS_GOOGLE_CLIENT_SECRET: 'r-s' }, built)).toEqual(built)
    expect(googleConfig({}, { clientId: '', clientSecret: '' })).toEqual({ clientId: undefined, clientSecret: undefined })
  })
})
