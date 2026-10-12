import { createHash, randomBytes } from 'crypto'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { Effect, Result } from 'effect'
import type { Credentials } from '../../shared/types'
import { AppError, AuthError, fail, messageOf, type ProviderError } from '../../errors'
import { request } from '../http'

export type GoogleCredentials = Extract<Credentials, { kind: 'google' }>

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Least privilege: read the calendar list, read/write events. No calendar create/delete, sharing (ACL) or settings access. */
export const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events'
const TIMEOUT_MS = 5 * 60 * 1000

export interface ClientConfig {
  clientId: string
  clientSecret: string
}

let clientConfig: Partial<ClientConfig> = {}

/** Set once at startup by the app (both from build-time MYSTICALS_GOOGLE_CLIENT_ID/SECRET). */
export function setClientConfig(cfg: Partial<ClientConfig>): void {
  clientConfig = cfg
}

export const getClientConfig: Effect.Effect<ClientConfig, AppError> = Effect.suspend(() => {
  const { clientId, clientSecret } = clientConfig
  if (!clientId || !clientSecret)
    return Effect.fail(fail('Google sign-in is not configured in this build: add a CalDAV account, or build from source with MYSTICALS_GOOGLE_CLIENT_ID/SECRET set'))
  return Effect.succeed({ clientId, clientSecret })
})

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

export function parseTokenResponse(json: unknown, now = Date.now()): Result.Result<TokenResult, AuthError | AppError> {
  const j = (json ?? {}) as Record<string, unknown>
  if (typeof j.error === 'string') {
    const message = `Google token error: ${j.error}${j.error_description ? ` (${j.error_description})` : ''}`
    // invalid_grant: the refresh token was revoked or expired.
    return Result.fail(j.error === 'invalid_grant' ? new AuthError({ message }) : fail(message))
  }
  if (typeof j.access_token !== 'string') return Result.fail(fail('Google token response has no access_token'))
  const expiresIn = typeof j.expires_in === 'number' ? j.expires_in : 3600
  return Result.succeed({
    accessToken: j.access_token,
    expiresAt: now + expiresIn * 1000,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : undefined,
    email: typeof j.id_token === 'string' ? emailFromIdToken(j.id_token) : undefined
  })
}

export const postToken = (params: Record<string, string>): Effect.Effect<TokenResult, ProviderError> =>
  request(
    TOKEN_URL,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() },
    async (res) => {
      const json = await res.json().catch(() => ({ error: `http_${res.status}` }))
      if (!res.ok && !json.error) json.error = `http_${res.status}`
      return json
    }
  ).pipe(Effect.flatMap((json) => Effect.fromResult(parseTokenResponse(json))))

const DONE_HTML = (msg: string, returnUrl?: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Mysticals</title><body style="font:15px -apple-system,sans-serif;text-align:center;padding-top:80px"><h2>${msg}</h2>` +
  (returnUrl
    ? `<p>Returning to Mysticals…</p><p><a href="${returnUrl}" style="display:inline-block;padding:8px 16px;border-radius:6px;background:#bd93f9;color:#0b0b10;font-weight:600;text-decoration:none">Open Mysticals</a></p><p style="color:#888">You can close this tab.</p><script>location.href=${JSON.stringify(returnUrl)}</script></body>`
    : `<p>You can close this tab and return to Mysticals.</p></body>`)

export interface OAuthOptions {
  /** The browser came back with a code: the rest (token exchange, email) takes a moment more. */
  onCode?: () => void
  /** App link (e.g. mysticals://) the success page opens so the browser hands focus back to the app. */
  returnUrl?: string
}

/**
 * OAuth for installed apps: system browser + loopback redirect + PKCE.
 * `openUrl` opens the system browser; injected so core stays platform-free.
 * Interrupting it (or the 5 minute timeout) closes the loopback server.
 */
export const runOAuthFlow = (
  openUrl: (url: string) => Promise<void>,
  opts: OAuthOptions = {}
): Effect.Effect<{ email: string; credentials: GoogleCredentials }, ProviderError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const cfg = yield* getClientConfig
      const { verifier, challenge } = createPkce()
      const state = randomBytes(16).toString('base64url')
      const server = yield* Effect.acquireRelease(
        Effect.callback<Server, AppError>((resume) => {
          const s = createServer()
          s.once('error', (e) => resume(Effect.fail(fail(e.message))))
          s.listen(0, '127.0.0.1', () => resume(Effect.succeed(s)))
        }),
        (s) =>
          Effect.sync(() => {
            s.closeAllConnections()
            s.close()
          })
      )
      const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

      const code = yield* Effect.callback<string, AppError>((resume) => {
        server.on('request', (req, res) => {
          const params = new URL(req.url ?? '/', redirectUri).searchParams
          // Settle only after the page is flushed, so closing the server can't cut it off.
          const reply = (status: number, msg: string, then: Effect.Effect<string, AppError>): void => {
            res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
            res.end(DONE_HTML(msg, status === 200 ? opts.returnUrl : undefined), () => resume(then))
          }
          if (!params.has('code') && !params.has('error')) {
            res.writeHead(404, { Connection: 'close' }).end()
            return
          }
          if (params.get('state') !== state) reply(400, 'Sign-in failed', Effect.fail(fail('Google sign-in failed: state mismatch')))
          else if (params.has('error')) reply(400, 'Sign-in cancelled', Effect.fail(fail(`Google sign-in failed: ${params.get('error')}`)))
          else reply(200, 'Signed in', Effect.succeed(params.get('code')!))
        })
        openUrl(buildAuthUrl({ clientId: cfg.clientId, redirectUri, state, codeChallenge: challenge })).catch((e) => resume(Effect.fail(fail(messageOf(e)))))
      }).pipe(Effect.timeoutOrElse({ duration: TIMEOUT_MS, orElse: () => Effect.fail(fail('Google sign-in timed out')) }))

      opts.onCode?.()
      const tok = yield* postToken({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret
      })
      if (!tok.refreshToken) return yield* fail('Google did not return a refresh token')
      const email = tok.email ?? (yield* fetchUserEmail(tok.accessToken))
      return { email, credentials: { kind: 'google' as const, refreshToken: tok.refreshToken, accessToken: tok.accessToken, expiresAt: tok.expiresAt } }
    })
  )

const fetchUserEmail = (accessToken: string): Effect.Effect<string, ProviderError> =>
  request('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } }, async (res) => ({
    ok: res.ok,
    json: (await res.json().catch(() => ({}))) as { email?: unknown }
  })).pipe(
    Effect.flatMap(({ ok, json }) => (ok && typeof json.email === 'string' ? Effect.succeed(json.email) : Effect.fail(fail('Could not read Google account email'))))
  )
