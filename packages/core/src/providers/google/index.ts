import type { Effect } from 'effect'
import type { ProviderError } from '../../errors'
import type { ProviderFactory } from '../types'
import { runOAuthFlow, type GoogleCredentials, type OAuthOptions } from './oauth'
import { createGoogleProviderImpl } from './provider'

export { setClientConfig } from './oauth'
export const createGoogleProvider: ProviderFactory = createGoogleProviderImpl

/** Runs OAuth (system browser via `openUrl`, loopback, PKCE). Needs `setClientConfig` first. */
export const googleSignIn = (
  openUrl: (url: string) => Promise<void>,
  opts?: OAuthOptions
): Effect.Effect<{ email: string; credentials: GoogleCredentials }, ProviderError> => runOAuthFlow(openUrl, opts)
