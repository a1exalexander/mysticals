import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import type { Credentials } from '../../shared/types'

export type GoogleCredentials = Extract<Credentials, { kind: 'google' }>

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const SCOPES = 'openid email https://www.googleapis.com/auth/calendar'
const TIMEOUT_MS = 5 * 60 * 1000

export interface ClientConfig {
  clientId: string
  clientSecret: string
}

let clientConfig: Partial<ClientConfig> = {}

/** Set once at startup by the app (desktop: MAIN_VITE_GOOGLE_*, terminal: build-time MULTICALS_GOOGLE_*). */
export function setClientConfig(cfg: Partial<ClientConfig>): void {
  clientConfig = cfg
}

export function getClientConfig(): ClientConfig {
  const { clientId, clientSecret } = clientConfig
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured: set the OAuth client id and secret (MAIN_VITE_GOOGLE_CLIENT_* in apps/desktop/.env, MULTICALS_GOOGLE_CLIENT_* when building the terminal app)')
  return { clientId, clientSecret }
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  }).toString()
  return url.toString()
}

/** Decodes the id_token payload. No signature check: the token came straight from Google's token endpoint over TLS. */
export function emailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.email === 'string' ? payload.email : undefined
  } catch {
    return undefined
  }
}

export interface TokenResult {
  accessToken: string
  expiresAt: number
  refreshToken?: string
  email?: string
}

export function parseTokenResponse(json: unknown, now = Date.now()): TokenResult {
  const j = (json ?? {}) as Record<string, unknown>
  if (typeof j.error === 'string') throw new Error(`Google token error: ${j.error}${j.error_description ? ` (${j.error_description})` : ''}`)
  if (typeof j.access_token !== 'string') throw new Error('Google token response has no access_token')
  const expiresIn = typeof j.expires_in === 'number' ? j.expires_in : 3600
  return {
    accessToken: j.access_token,
    expiresAt: now + expiresIn * 1000,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : undefined,
    email: typeof j.id_token === 'string' ? emailFromIdToken(j.id_token) : undefined
  }
}

export async function postToken(params: Record<string, string>): Promise<TokenResult> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  const json = await res.json().catch(() => ({ error: `http_${res.status}` }))
  if (!res.ok && !json.error) json.error = `http_${res.status}`
  return parseTokenResponse(json)
}

const DONE_HTML = (msg: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Multicals</title><body style="font:15px -apple-system,sans-serif;text-align:center;padding-top:80px"><h2>${msg}</h2><p>You can close this tab and return to Multicals.</p></body>`

/**
 * OAuth for installed apps: system browser + loopback redirect + PKCE.
 * `openUrl` opens the system browser; injected so core stays platform-free.
 */
export async function runOAuthFlow(openUrl: (url: string) => Promise<void>): Promise<{ email: string; credentials: GoogleCredentials }> {
  const cfg = getClientConfig()
  const { verifier, challenge } = createPkce()
  const state = randomBytes(16).toString('base64url')
  const server = createServer()

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Google sign-in timed out')), TIMEOUT_MS)
      const finish = (err: Error | null, value?: string): void => {
        clearTimeout(timer)
        if (err) reject(err)
        else resolve(value!)
      }
      server.on('request', (req, res) => {
        const params = new URL(req.url ?? '/', redirectUri).searchParams
        // Settle only after the page is flushed, so closing the server can't cut it off.
        const reply = (status: number, msg: string, then: () => void): void => {
          res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
          res.end(DONE_HTML(msg), then)
        }
        if (!params.has('code') && !params.has('error')) {
          res.writeHead(404, { Connection: 'close' }).end()
          return
        }
        if (params.get('state') !== state) {
          reply(400, 'Sign-in failed', () => finish(new Error('Google sign-in failed: state mismatch')))
        } else if (params.has('error')) {
          reply(400, 'Sign-in cancelled', () => finish(new Error(`Google sign-in failed: ${params.get('error')}`)))
        } else {
          const code = params.get('code')!
          reply(200, 'Signed in', () => finish(null, code))
        }
      })
      openUrl(buildAuthUrl({ clientId: cfg.clientId, redirectUri, state, codeChallenge: challenge })).catch((e) =>
        finish(e instanceof Error ? e : new Error(String(e)))
      )
    })

    const tok = await postToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret
    })
    if (!tok.refreshToken) throw new Error('Google did not return a refresh token')
    const email = tok.email ?? (await fetchUserEmail(tok.accessToken))
    return { email, credentials: { kind: 'google', refreshToken: tok.refreshToken, accessToken: tok.accessToken, expiresAt: tok.expiresAt } }
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
  const json = (await res.json().catch(() => ({}))) as { email?: unknown }
  if (!res.ok || typeof json.email !== 'string') throw new Error('Could not read Google account email')
  return json.email
}
