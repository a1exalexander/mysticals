import type { ProviderFactory } from '../types'
import { runOAuthFlow, type GoogleCredentials } from './oauth'
import { createGoogleProviderImpl } from './provider'

export { setClientConfig } from './oauth'
export const createGoogleProvider: ProviderFactory = createGoogleProviderImpl

/** Runs OAuth (system browser via `openUrl`, loopback, PKCE). Needs `setClientConfig` first. */
export async function googleSignIn(
  openUrl: (url: string) => Promise<void>
): Promise<{ email: string; credentials: GoogleCredentials }> {
  return runOAuthFlow(openUrl)
}
