import { execFileSync, spawnSync } from 'child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import type { SecretCrypto } from '@multicals/core/accounts/store'

/** Where the 32-byte master key lives. */
export interface KeyStore {
  get(): Buffer | undefined
  set(key: Buffer): void
}

const SERVICE = 'multicals-terminal'
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

const VERSION = 1
const IV = 12
const TAG = 16

/**
 * AES-256-GCM for per-account credentials. Blob: [version:1][iv:12][tag:16][ciphertext].
 * The master key is created on first encrypt; decrypting without it fails loudly.
 */
export function createCrypto(store?: KeyStore): SecretCrypto {
  if (!store && process.platform !== 'darwin') {
    // Refuse rather than fall back to plaintext.
    const unavailable = (): never => {
      throw new Error('Secure storage unavailable: multicals keeps credentials only in the macOS Keychain')
    }
    return { encrypt: unavailable, decrypt: unavailable }
  }
  const keys = store ?? keychain()

  let cached: Buffer | undefined
  const key = (create: boolean): Buffer => {
    if (cached) return cached
    let k = keys.get()
    if (!k) {
      if (!create) throw new Error('Master key missing from Keychain (service "multicals-terminal"); re-add your accounts')
      k = randomBytes(32)
      keys.set(k)
    }
    if (k.length !== 32) throw new Error('Master key in Keychain is corrupt')
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
