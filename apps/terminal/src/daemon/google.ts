import { execFile } from 'child_process'

// Injected by tsup `define` from apps/terminal/.env at build time; empty when unset.
declare const __GOOGLE_CLIENT_ID__: string
declare const __GOOGLE_CLIENT_SECRET__: string
const built = {
  clientId: typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : '',
  clientSecret: typeof __GOOGLE_CLIENT_SECRET__ === 'string' ? __GOOGLE_CLIENT_SECRET__ : ''
}

/**
 * Runtime MYSTICALS_GOOGLE_CLIENT_ID/SECRET replace the build-time pair as a whole (never mix two clients).
 * Missing values stay undefined so core's sign-in reports "not configured".
 */
export function googleConfig(env = process.env, defaults = built): { clientId?: string; clientSecret?: string } {
  const id = env.MYSTICALS_GOOGLE_CLIENT_ID
  const src = id ? { clientId: id, clientSecret: env.MYSTICALS_GOOGLE_CLIENT_SECRET } : defaults
  return { clientId: src.clientId || undefined, clientSecret: src.clientSecret || undefined }
}

/** Opens `url` in the default browser. */
export const openUrl = (url: string): Promise<void> =>
  new Promise((resolve, reject) => execFile('open', [url], (e) => (e ? reject(e) : resolve())))
