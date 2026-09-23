import type { SecretCrypto } from '@multicals/core/accounts/store'

/**
 * Per-account credential encryption for the daemon.
 * Unit 6 replaces this stub: AES-256-GCM with a master key kept in the macOS Keychain.
 */
export function createCrypto(): SecretCrypto {
  const fail = (): never => {
    throw new Error('Credential storage is not implemented yet')
  }
  return { encrypt: fail, decrypt: fail }
}
