import { createHash } from 'crypto'
import { get } from 'http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAuthUrl, createPkce, emailFromIdToken, getClientConfig, parseTokenResponse, runOAuthFlow } from './oauth'

const jwt = (payload: object): string => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`

beforeEach(() => {
  vi.stubEnv('MAIN_VITE_GOOGLE_CLIENT_ID', 'cid')
  vi.stubEnv('MAIN_VITE_GOOGLE_CLIENT_SECRET', 'secret')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('oauth pure parts', () => {
  it('builds PKCE S256 challenge from verifier', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('builds auth url with offline access, consent, PKCE and scopes', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5000', state: 'st', codeChallenge: 'ch' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = Object.fromEntries(u.searchParams)
    expect(p).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:5000',
      response_type: 'code',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      scope: 'openid email https://www.googleapis.com/auth/calendar'
    })
  })

  it('parses token response and id_token email', () => {
    const r = parseTokenResponse({ access_token: 'a', expires_in: 100, refresh_token: 'r', id_token: jwt({ email: 'me@gmail.com' }) }, 1000)
    expect(r).toEqual({ accessToken: 'a', expiresAt: 101000, refreshToken: 'r', email: 'me@gmail.com' })
    expect(emailFromIdToken('garbage')).toBeUndefined()
    expect(() => parseTokenResponse({ error: 'invalid_grant' })).toThrow(/invalid_grant/)
  })

  it('throws a clear error when client id is missing', () => {
    vi.stubEnv('MAIN_VITE_GOOGLE_CLIENT_ID', '')
    expect(() => getClientConfig()).toThrow('Set MAIN_VITE_GOOGLE_CLIENT_ID in .env')
  })
})

/** Simulates the browser hitting the loopback redirect. */
const hit = (url: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) =>
    get(url, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    }).on('error', reject)
  )

describe('runOAuthFlow', () => {
  it('verifies state, exchanges code with PKCE verifier, returns email + refresh token', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'at', expires_in: 3600, refresh_token: 'rt', id_token: jwt({ email: 'me@gmail.com' }) }))
    vi.stubGlobal('fetch', fetchMock)
    let page: Promise<{ body: string }> | undefined
    const result = await runOAuthFlow(async (authUrl) => {
      const p = new URL(authUrl).searchParams
      page = hit(`${p.get('redirect_uri')}/?code=abc&state=${p.get('state')}`)
    })
    expect((await page!).body).toContain('You can close this tab')
    expect(result.email).toBe('me@gmail.com')
    expect(result.credentials).toMatchObject({ kind: 'google', refreshToken: 'rt', accessToken: 'at' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('code')).toBe('abc')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects a mismatched state and never exchanges the code', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      runOAuthFlow(async (authUrl) => {
        await hit(`${new URL(authUrl).searchParams.get('redirect_uri')}/?code=abc&state=evil`)
      })
    ).rejects.toThrow(/state mismatch/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
