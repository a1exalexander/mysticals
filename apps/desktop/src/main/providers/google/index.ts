import { shell } from 'electron'
import type { ProviderFactory } from '../types'
import { runOAuthFlow, type GoogleCredentials } from './oauth'
import { createGoogleProviderImpl } from './provider'

export const createGoogleProvider: ProviderFactory = createGoogleProviderImpl

/** Runs OAuth (system browser, loopback, PKCE). Returns identity + credentials. */
export async function googleSignIn(): Promise<{ email: string; credentials: GoogleCredentials }> {
  return runOAuthFlow((url) => shell.openExternal(url))
}
