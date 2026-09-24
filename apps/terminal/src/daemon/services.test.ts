import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountStore } from '@mysticals/core/accounts/store'
import type { Note } from '@mysticals/core/sync/notify'
import { createCrypto, dpapi, platformKeys, secretTool, type KeyStore, type Run } from './crypto'
import { googleConfig, openCommand } from './google'
import { bannerCommand, notify } from './notify'
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

  it('never mints a new key over existing credentials', () => {
    const home = mkdtempSync(join(tmpdir(), 'mysticals-home-'))
    const keys = memKeys()
    expect(createCrypto(keys, home).encrypt('x')).toBeDefined() // no accounts yet: first key is fine
    mkdirSync(join(home, 'accounts', 'a1'), { recursive: true })
    writeFileSync(join(home, 'accounts', 'a1', 'creds.bin'), 'blob')
    const lost = memKeys()
    expect(() => createCrypto(lost, home).encrypt('y')).toThrow('saved credentials exist')
    expect(lost.key).toBeUndefined()
  })
})

/** Fake spawnSync that records calls and answers from `reply`. */
const fakeRun = (reply: (cmd: string, args: string[], input?: string) => Partial<ReturnType<Run>>) => {
  const calls: { cmd: string; args: string[]; input?: string }[] = []
  const run: Run = (cmd, args, opts) => {
    calls.push({ cmd, args, input: opts.input })
    return { status: 0, stdout: '', stderr: '', ...reply(cmd, args, opts.input) }
  }
  return { run, calls }
}

describe('key stores', () => {
  const key = Buffer.alloc(32, 7)

  it('secret-tool: missing item is undefined, key goes via stdin, lookup decodes', () => {
    const { run, calls } = fakeRun((_, args) => (args[0] === 'lookup' ? { status: 1 } : {}))
    const s = secretTool('svc', run)
    expect(s.get()).toBeUndefined()
    s.set(key)
    expect(calls[1].args).not.toContain(key.toString('base64'))
    expect(calls[1].input).toBe(key.toString('base64'))
    const found = fakeRun(() => ({ stdout: `${key.toString('base64')}\n` }))
    expect(secretTool('svc', found.run).get()?.equals(key)).toBe(true)
  })

  it('secret-tool: exit 1 with stderr (no D-Bus / locked keyring) is an outage, not "no key"', () => {
    const { run } = fakeRun(() => ({ status: 1, stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' }))
    expect(() => secretTool('svc', run).get()).toThrow('Secret Service unavailable')
    const keys = secretTool('svc', run)
    expect(() => createCrypto(keys).encrypt('x')).toThrow('GNOME Keyring or KWallet')
  })

  it('secret-tool: a missing binary fails loudly instead of looking like "no key"', () => {
    const { run } = fakeRun(() => ({ status: null, error: new Error('spawnSync secret-tool ENOENT') }))
    expect(() => secretTool('svc', run).get()).toThrow('install libsecret-tools')
  })

  it('dpapi: stores only the sealed blob and unseals it on read', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mysticals-dpapi-')), 'master.key')
    // Fake "seal": reverse the base64 so the file never holds the raw key.
    const { run, calls } = fakeRun((_, __, input = '') => ({ stdout: [...input].reverse().join('') }))
    const s = dpapi(file, run)
    expect(s.get()).toBeUndefined()
    s.set(key)
    expect(readFileSync(file, 'utf8')).not.toBe(key.toString('base64'))
    expect(s.get()?.equals(key)).toBe(true)
    expect(calls.map((c) => c.args.at(-1))).toEqual([expect.stringContaining('::Protect('), expect.stringContaining('::Unprotect(')])
  })

  it('has a store on macOS, Linux and Windows only', () => {
    expect(platformKeys('darwin')).toBeDefined()
    expect(platformKeys('linux')).toBeDefined()
    expect(platformKeys('win32')).toBeDefined()
    expect(platformKeys('freebsd')).toBeUndefined()
  })
})

describe('openCommand', () => {
  it('keeps the url one argv item on every OS', () => {
    const url = 'https://accounts.google.com/o?a=1&b=2'
    expect(openCommand(url, 'darwin')).toEqual(['open', [url]])
    expect(openCommand(url, 'linux')).toEqual(['xdg-open', [url]])
    expect(openCommand(url, 'win32')).toEqual(['rundll32', ['url.dll,FileProtocolHandler', url]])
  })
})

describe('bannerCommand', () => {
  it('passes text as data, never as script', () => {
    const t = 'Say "hi"; $(rm -rf ~)'
    expect(bannerCommand(t, 'b', 'linux')?.args.slice(-2)).toEqual([t, 'b'])
    const win = bannerCommand(t, 'b', 'win32')
    expect(win?.args.join(' ')).not.toContain(t)
    expect(win?.env).toMatchObject({ MYSTICALS_NOTE_TITLE: t, MYSTICALS_NOTE_BODY: 'b' })
    expect(bannerCommand(t, 'b', 'freebsd')).toBeUndefined()
  })
})

describe('notify', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('passes text as osascript argv and skips hidden calendars', () => {
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
    notify(store, 'a', [ev('hidden', 'Nope'), ev('cal', 'Say "hi"')], run, 'darwin')
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
