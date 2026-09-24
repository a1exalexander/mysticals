import { execFileSync, spawnSync } from 'child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { SecretCrypto } from '@mysticals/core/accounts/store'
import { homeDir } from '../paths'

/** Where the 32-byte master key lives. */
export interface KeyStore {
  get(): Buffer | undefined
  set(key: Buffer): void
}

const SERVICE = 'mysticals-terminal'
const ACCOUNT = 'master-key'
const NOT_FOUND = 44 // `security` exit code for a missing item
// ponytail: sync calls block the daemon (all TUIs) while Keychain asks to unlock; capped, go async if it bites.
const TIMEOUT = 60_000

/** macOS login Keychain generic password (base64), via the `security` CLI. */
export function keychain(service = SERVICE): KeyStore {
  return {
    get() {
      const r = spawnSync('security', ['find-generic-password', '-s', service, '-a', ACCOUNT, '-w'], { encoding: 'utf8', timeout: TIMEOUT })
      if (r.status === NOT_FOUND) return undefined
      if (r.status !== 0) throw new Error(`Keychain read failed: ${r.error?.message ?? r.stderr?.trim()}`)
      return Buffer.from(r.stdout.trim(), 'base64')
    },
    set(key) {
      // `security -i` reads the command from stdin, so the key never shows up in `ps` argv.
      const cmd = `add-generic-password -U -s ${service} -a ${ACCOUNT} -w ${key.toString('base64')}\n`
      execFileSync('security', ['-i'], { input: cmd, stdio: ['pipe', 'ignore', 'pipe'], timeout: TIMEOUT })
    }
  }
}

/** spawnSync subset the Linux/Windows stores use; injectable for tests. */
export type Run = (
  cmd: string,
  args: string[],
  opts: { input?: string; encoding: 'utf8'; timeout: number; windowsHide: true }
) => { status: number | null; stdout: string; stderr: string; error?: Error }

const exec = (run: Run, cmd: string, args: string[], input?: string): ReturnType<Run> =>
  run(cmd, args, { input, encoding: 'utf8', timeout: TIMEOUT, windowsHide: true })

/** Linux Secret Service (GNOME Keyring, KWallet, …) via `secret-tool` from libsecret-tools. */
export function secretTool(service = SERVICE, run: Run = spawnSync as Run): KeyStore {
  const attrs = ['service', service, 'account', ACCOUNT]
  const fail = (what: string, r: ReturnType<Run>): never => {
    throw new Error(
      `Secret Service ${what} failed (${r.error?.message ?? r.stderr?.trim()}); install libsecret-tools and run a keyring such as gnome-keyring`
    )
  }
  return {
    get() {
      const r = exec(run, 'secret-tool', ['lookup', ...attrs])
      // `lookup` exits 1 with no output when the item does not exist.
      if (r.status === 1 && !r.error && !r.stdout.trim()) return undefined
      if (r.status !== 0) return fail('read', r)
      return Buffer.from(r.stdout.trim(), 'base64')
    },
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
export function dpapi(file = join(homeDir(), 'master.key'), run: Run = spawnSync as Run): KeyStore {
  const ps = (op: 'Protect' | 'Unprotect', b64: string): string => {
    const r = exec(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', dpapiScript(op)], b64)
    if (r.status !== 0) throw new Error(`DPAPI ${op} failed: ${r.error?.message ?? r.stderr?.trim()}`)
    return r.stdout.trim()
  }
  return {
    get() {
      if (!existsSync(file)) return undefined
      return Buffer.from(ps('Unprotect', readFileSync(file, 'utf8').trim()), 'base64')
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

const VERSION = 1
const IV = 12
const TAG = 16

/**
 * AES-256-GCM for per-account credentials. Blob: [version:1][iv:12][tag:16][ciphertext].
 * The master key is created on first encrypt; decrypting without it fails loudly.
 */
export function createCrypto(store = platformKeys()): SecretCrypto {
  if (!store) {
    // Refuse rather than fall back to plaintext.
    const unavailable = (): never => {
      throw new Error(`Secure storage unavailable: no supported OS key store on ${process.platform}`)
    }
    return { encrypt: unavailable, decrypt: unavailable }
  }
  const keys = store

  let cached: Buffer | undefined
  const key = (create: boolean): Buffer => {
    if (cached) return cached
    let k = keys.get()
    if (!k) {
      if (!create) throw new Error('Master key missing from the OS key store (service "mysticals-terminal"); re-add your accounts')
      k = randomBytes(32)
      keys.set(k)
    }
    if (k.length !== 32) throw new Error('Master key in the OS key store is corrupt')
    return (cached = k)
  }

  return {
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
