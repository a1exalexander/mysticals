import { spawn } from 'child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { Effect, Semaphore } from 'effect'
import { AppError, fail, messageOf } from '@mysticals/core/errors'
import type { SecretCrypto } from '@mysticals/core/accounts/store'
import { homeDir } from '../paths'

/** Where the 32-byte master key lives. */
export interface KeyStore {
  get(): Effect.Effect<Buffer | undefined, AppError>
  set(key: Buffer): Effect.Effect<void, AppError>
}

const SERVICE = 'mysticals-terminal'
const ACCOUNT = 'master-key'
const NOT_FOUND = 44 // `security` exit code for a missing item
// Keychain may wait for the user to unlock it; the daemon keeps serving meanwhile, but not forever.
const TIMEOUT = 60_000

/** One key store command: input on stdin (so secrets never show up in `ps` argv); injectable for tests. */
export type Run = (cmd: string, args: string[], input?: string) => Effect.Effect<{ status: number | null; stdout: string; stderr: string; error?: Error }>

/** Runs the command without blocking the event loop; killed after TIMEOUT or when interrupted. */
export const spawnRun: Run = (cmd, args, input) =>
  Effect.callback((resume) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (status: number | null, error?: Error): void => {
      if (done) return
      done = true
      resume(Effect.succeed({ status, stdout, stderr, ...(error ? { error } : {}) }))
    }
    const child = spawn(cmd, args, { windowsHide: true, timeout: TIMEOUT })
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', (e) => finish(null, e))
    child.on('close', (status) => finish(status))
    child.stdin.on('error', () => {}) // a command that exits early closes its stdin; 'close' reports it
    child.stdin.end(input ?? '')
    return Effect.sync(() => void child.kill())
  })

/** macOS login Keychain generic password (base64), via the `security` CLI. */
export function keychain(service = SERVICE, run: Run = spawnRun): KeyStore {
  return {
    get: () =>
      Effect.flatMap(run('security', ['find-generic-password', '-s', service, '-a', ACCOUNT, '-w']), (r) => {
        if (r.status === NOT_FOUND) return Effect.succeed(undefined)
        if (r.status !== 0) return Effect.fail(fail(`Keychain read failed: ${r.error?.message ?? r.stderr?.trim()}`))
        return Effect.succeed(Buffer.from(r.stdout.trim(), 'base64'))
      }),
    // `security -i` reads the command from stdin, so the key never shows up in `ps` argv.
    set: (key) =>
      Effect.flatMap(run('security', ['-i'], `add-generic-password -U -s ${service} -a ${ACCOUNT} -w ${key.toString('base64')}\n`), (r) =>
        r.status === 0 ? Effect.void : Effect.fail(fail(`Keychain write failed: ${r.error?.message ?? r.stderr?.trim()}`))
      )
  }
}

/** Linux Secret Service (GNOME Keyring, KWallet, …) via `secret-tool` from libsecret-tools. */
export function secretTool(service = SERVICE, run: Run = spawnRun): KeyStore {
  const attrs = ['service', service, 'account', ACCOUNT]
  return {
    get: () =>
      Effect.flatMap(run('secret-tool', ['lookup', ...attrs]), (r) => {
        // `lookup` exits 1 with no output when the item does not exist; anything on stderr (no D-Bus, locked or
        // missing keyring) is an outage, never "no key", or we would mint a new key over the real one.
        if (r.status === 1 && !r.error && !r.stdout.trim() && !r.stderr.trim()) return Effect.succeed(undefined)
        if (r.status !== 0)
          return Effect.fail(
            fail(`Secret Service unavailable (${r.error?.message ?? r.stderr?.trim()}); start or unlock GNOME Keyring or KWallet (and install libsecret-tools)`)
          )
        return Effect.succeed(Buffer.from(r.stdout.trim(), 'base64'))
      }),
    // `store` reads the secret from stdin, so it never shows up in `ps` argv.
    set: (key) =>
      Effect.flatMap(run('secret-tool', ['store', '--label=mysticals terminal master key', ...attrs], key.toString('base64')), (r) =>
        r.status === 0
          ? Effect.void
          : Effect.fail(
              fail(`Secret Service write failed (${r.error?.message ?? r.stderr?.trim()}); install libsecret-tools and run a keyring such as gnome-keyring`)
            )
      )
  }
}

// Base64 in on stdin, base64 out; `Protect`/`Unprotect` with the current Windows user's DPAPI key.
const dpapiScript = (op: 'Protect' | 'Unprotect'): string =>
  'Add-Type -AssemblyName System.Security; ' +
  '$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
  `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}($b, $null, 'CurrentUser'))`

/** Windows: master key sealed with DPAPI (current user) in `file`, via the built-in Windows PowerShell. */
export function dpapi(file = join(homeDir(), 'master.key'), run: Run = spawnRun): KeyStore {
  const ps = (op: 'Protect' | 'Unprotect', b64: string): Effect.Effect<string, AppError> =>
    Effect.flatMap(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', dpapiScript(op)], b64), (r) =>
      r.status === 0 ? Effect.succeed(r.stdout.trim()) : Effect.fail(fail(`DPAPI ${op} failed: ${r.error?.message ?? r.stderr?.trim()}`))
    )
  const io = <A>(f: () => A): Effect.Effect<A, AppError> => Effect.try({ try: f, catch: (e) => fail(messageOf(e)) })
  return {
    get: () =>
      Effect.gen(function* () {
        if (!existsSync(file)) return undefined
        const sealed = yield* io(() => readFileSync(file, 'utf8').trim())
        return Buffer.from(yield* ps('Unprotect', sealed), 'base64')
      }),
    set: (key) =>
      Effect.gen(function* () {
        const sealed = yield* ps('Protect', key.toString('base64'))
        yield* io(() => {
          mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
          writeFileSync(file, sealed, { mode: 0o600 })
        })
      })
  }
}

/** The OS secret store for the master key, or undefined where there is none we trust. */
export function platformKeys(platform = process.platform): KeyStore | undefined {
  if (platform === 'darwin') return keychain()
  if (platform === 'linux') return secretTool()
  if (platform === 'win32') return dpapi()
  return undefined
}

/** True when any account under `home` has an encrypted credentials file. */
const hasCredentials = (home: string): boolean => {
  const dir = join(home, 'accounts')
  return existsSync(dir) && readdirSync(dir).some((id) => existsSync(join(dir, id, 'creds.bin')))
}

const VERSION = 1
const IV = 12
const TAG = 16

/**
 * AES-256-GCM for per-account credentials. Blob: [version:1][iv:12][tag:16][ciphertext].
 * The master key is created on first encrypt; decrypting without it fails loudly.
 */
export function createCrypto(store = platformKeys(), home?: string): (typeof SecretCrypto)['Service'] {
  if (!store) {
    // Refuse rather than fall back to plaintext.
    const unavailable = Effect.fail(fail(`Secure storage unavailable: no supported OS key store on ${process.platform}`))
    return { encrypt: () => unavailable, decrypt: () => unavailable }
  }
  const keys = store

  let cached: Buffer | undefined
  // One key store round trip at a time: two first syncs must not both mint a key.
  const lock = Semaphore.makeUnsafe(1)
  const key = (create: boolean): Effect.Effect<Buffer, AppError> =>
    Semaphore.withPermit(
      lock,
      Effect.gen(function* () {
        if (cached) return cached
        let k = yield* keys.get()
        if (!k) {
          if (!create) return yield* fail('Master key missing from the OS key store (service "mysticals-terminal"); re-add your accounts')
          // A fresh key would orphan every saved credential for good; make the user clear them knowingly instead.
          if (home && hasCredentials(home))
            return yield* fail(
              `Master key missing from the OS key store but saved credentials exist; unlock the key store, or remove all accounts (or ${join(home, 'accounts')}) to start over`
            )
          k = randomBytes(32)
          yield* keys.set(k)
        }
        if (k.length !== 32) return yield* fail('Master key in the OS key store is corrupt')
        return (cached = k)
      })
    )

  return {
    encrypt: (plain) =>
      Effect.map(key(true), (k) => {
        const iv = randomBytes(IV)
        const c = createCipheriv('aes-256-gcm', k, iv)
        const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
        return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body])
      }),
    decrypt: (bytes) =>
      Effect.gen(function* () {
        const data = Buffer.from(bytes)
        if (data.length < 1 + IV + TAG || data[0] !== VERSION) return yield* fail('Unsupported credential format')
        const k = yield* key(false)
        return yield* Effect.try({
          try: () => {
            const d = createDecipheriv('aes-256-gcm', k, data.subarray(1, 1 + IV))
            d.setAuthTag(data.subarray(1 + IV, 1 + IV + TAG))
            return Buffer.concat([d.update(data.subarray(1 + IV + TAG)), d.final()]).toString('utf8')
          },
          catch: (e) => fail(messageOf(e))
        })
      })
  }
}
