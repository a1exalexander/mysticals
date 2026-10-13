import { execFileSync, spawn, spawnSync } from 'child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { SecretCrypto } from '@mysticals/core/accounts/store'
import { homeDir } from '../paths'

/** Where the 32-byte master key lives. */
export interface KeyStore {
  get(): Buffer | undefined
  set(key: Buffer): void
  /** `get` without blocking the event loop (see `createCrypto().preload`). */
  load?(): Promise<Buffer | undefined>
}

const SERVICE = 'mysticals-terminal'
const ACCOUNT = 'master-key'
const NOT_FOUND = 44 // `security` exit code for a missing item
// Sync calls block the daemon (all TUIs) while Keychain asks to unlock: the daemon preloads the key with `load`
// at startup, so they only run when that failed (or to create the first key).
const TIMEOUT = 60_000

/** macOS login Keychain generic password (base64), via the `security` CLI. */
export function keychain(service = SERVICE, runAsync: RunAsync = spawnAsync): KeyStore {
  const args = ['find-generic-password', '-s', service, '-a', ACCOUNT, '-w']
  const read = (r: RunResult): Buffer | undefined => {
    if (r.status === NOT_FOUND) return undefined
    if (r.status !== 0) throw new Error(`Keychain read failed: ${r.error?.message ?? r.stderr?.trim()}`)
    return Buffer.from(r.stdout.trim(), 'base64')
  }
  return {
    get: () => read(spawnSync('security', args, { encoding: 'utf8', timeout: TIMEOUT })),
    load: async () => read(await runAsync('security', args, { encoding: 'utf8', timeout: TIMEOUT, windowsHide: true })),
    set(key) {
      // `security -i` reads the command from stdin, so the key never shows up in `ps` argv.
      const cmd = `add-generic-password -U -s ${service} -a ${ACCOUNT} -w ${key.toString('base64')}\n`
      execFileSync('security', ['-i'], { input: cmd, stdio: ['pipe', 'ignore', 'pipe'], timeout: TIMEOUT })
    }
  }
}

type RunOpts = { input?: string; encoding: 'utf8'; timeout: number; windowsHide: true }
type RunResult = { status: number | null; stdout: string; stderr: string; error?: Error }
/** spawnSync subset the Linux/Windows stores use; injectable for tests. */
export type Run = (cmd: string, args: string[], opts: RunOpts) => RunResult
/** The same, without blocking the event loop. */
export type RunAsync = (cmd: string, args: string[], opts: RunOpts) => Promise<RunResult>

export const spawnAsync: RunAsync = (cmd, args, opts) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (status: number | null, error?: Error): void => {
      if (done) return
      done = true
      resolve({ status, stdout, stderr, ...(error ? { error } : {}) })
    }
    const child = spawn(cmd, args, { timeout: opts.timeout, windowsHide: true })
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', (e) => finish(null, e))
    child.on('close', (status) => finish(status))
    child.stdin.on('error', () => {}) // a command that exits early closes its stdin; 'close' reports it
    child.stdin.end(opts.input ?? '')
  })

const exec = <R>(run: (cmd: string, args: string[], opts: RunOpts) => R, cmd: string, args: string[], input?: string): R =>
  run(cmd, args, { input, encoding: 'utf8', timeout: TIMEOUT, windowsHide: true })

/** Linux Secret Service (GNOME Keyring, KWallet, …) via `secret-tool` from libsecret-tools. */
export function secretTool(service = SERVICE, run: Run = spawnSync as Run, runAsync: RunAsync = spawnAsync): KeyStore {
  const attrs = ['service', service, 'account', ACCOUNT]
  const read = (r: RunResult): Buffer | undefined => {
    // `lookup` exits 1 with no output when the item does not exist; anything on stderr (no D-Bus, locked or
    // missing keyring) is an outage, never "no key", or we would mint a new key over the real one.
    if (r.status === 1 && !r.error && !r.stdout.trim() && !r.stderr.trim()) return undefined
    if (r.status !== 0)
      throw new Error(
        `Secret Service unavailable (${r.error?.message ?? r.stderr?.trim()}); start or unlock GNOME Keyring or KWallet (and install libsecret-tools)`
      )
    return Buffer.from(r.stdout.trim(), 'base64')
  }
  const fail = (what: string, r: RunResult): never => {
    throw new Error(
      `Secret Service ${what} failed (${r.error?.message ?? r.stderr?.trim()}); install libsecret-tools and run a keyring such as gnome-keyring`
    )
  }
  return {
    get: () => read(exec(run, 'secret-tool', ['lookup', ...attrs])),
    load: async () => read(await exec(runAsync, 'secret-tool', ['lookup', ...attrs])),
    set(key) {
      // `store` reads the secret from stdin, so it never shows up in `ps` argv.
      const r = exec(run, 'secret-tool', ['store', '--label=mysticals terminal master key', ...attrs], key.toString('base64'))
      if (r.status !== 0) fail('write', r)
    }
  }
}

// Base64 in on stdin, base64 out; `Protect`/`Unprotect` with the current Windows user's DPAPI key.
const dpapiScript = (op: 'Protect' | 'Unprotect'): string =>
  'Add-Type -AssemblyName System.Security; ' +
  '$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
  `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}($b, $null, 'CurrentUser'))`

/** Windows: master key sealed with DPAPI (current user) in `file`, via the built-in Windows PowerShell. */
export function dpapi(file = join(homeDir(), 'master.key'), run: Run = spawnSync as Run, runAsync: RunAsync = spawnAsync): KeyStore {
  const out = (op: string, r: RunResult): string => {
    if (r.status !== 0) throw new Error(`DPAPI ${op} failed: ${r.error?.message ?? r.stderr?.trim()}`)
    return r.stdout.trim()
  }
  const args = (op: 'Protect' | 'Unprotect'): string[] => ['-NoProfile', '-NonInteractive', '-Command', dpapiScript(op)]
  const ps = (op: 'Protect' | 'Unprotect', b64: string): string => out(op, exec(run, 'powershell.exe', args(op), b64))
  return {
    get() {
      if (!existsSync(file)) return undefined
      return Buffer.from(ps('Unprotect', readFileSync(file, 'utf8').trim()), 'base64')
    },
    load: async () => {
      if (!existsSync(file)) return undefined
      const sealed = (await readFile(file, 'utf8')).trim()
      return Buffer.from(out('Unprotect', await exec(runAsync, 'powershell.exe', args('Unprotect'), sealed)), 'base64')
    },
    set(key) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      writeFileSync(file, ps('Protect', key.toString('base64')), { mode: 0o600 })
    }
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
export function createCrypto(store = platformKeys(), home?: string): SecretCrypto & { preload(): Promise<void> } {
  if (!store) {
    // Refuse rather than fall back to plaintext.
    const unavailable = (): never => {
      throw new Error(`Secure storage unavailable: no supported OS key store on ${process.platform}`)
    }
    return { encrypt: unavailable, decrypt: unavailable, preload: async () => {} }
  }
  const keys = store

  let cached: Buffer | undefined
  const key = (create: boolean): Buffer => {
    if (cached) return cached
    let k = keys.get()
    if (!k) {
      if (!create) throw new Error('Master key missing from the OS key store (service "mysticals-terminal"); re-add your accounts')
      // A fresh key would orphan every saved credential for good; make the user clear them knowingly instead.
      if (home && hasCredentials(home))
        throw new Error(
          `Master key missing from the OS key store but saved credentials exist; unlock the key store, or remove all accounts (or ${join(home, 'accounts')}) to start over`
        )
      k = randomBytes(32)
      keys.set(k)
    }
    if (k.length !== 32) throw new Error('Master key in the OS key store is corrupt')
    return (cached = k)
  }

  return {
    /**
     * Reads the existing master key without blocking the event loop, so the first sync's decrypt doesn't stall
     * every TUI on a Keychain prompt. Never creates a key; on failure the sync path below reports the error.
     */
    async preload() {
      if (cached) return
      try {
        const k = await keys.load?.()
        if (k?.length === 32) cached ??= k
      } catch {
        // decrypt/encrypt will surface it
      }
    },
    encrypt(plain) {
      const iv = randomBytes(IV)
      const c = createCipheriv('aes-256-gcm', key(true), iv)
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body])
    },
    decrypt(data) {
      if (data.length < 1 + IV + TAG || data[0] !== VERSION) throw new Error('Unsupported credential format')
      const d = createDecipheriv('aes-256-gcm', key(false), data.subarray(1, 1 + IV))
      d.setAuthTag(data.subarray(1 + IV, 1 + IV + TAG))
      return Buffer.concat([d.update(data.subarray(1 + IV + TAG)), d.final()]).toString('utf8')
    }
  }
}
