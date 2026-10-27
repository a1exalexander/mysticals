import { AppError } from '../errors'

/** Per-request budget (headers + body), and retries of transient failures. Mutable only so tests can change them. */
export const http = { timeoutMs: 30_000, retries: 2, backoffMs: 500 }

/**
 * `fetch` that gives up after `http.timeoutMs`, so one hung server can't keep a sync running forever.
 * A caller's own signal still aborts it too.
 */
export const timedFetch: typeof fetch = async (input, init) => {
  const timeout = AbortSignal.timeout(http.timeoutMs)
  try {
    return await fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
  } catch (e) {
    if (timeout.aborted) throw new TimeoutError('error.timeout', { host: new URL(String(input instanceof Request ? input.url : input)).host })
    throw e
  }
}

/** `timedFetch` gave up waiting. */
export class TimeoutError extends AppError {
  override name = 'TimeoutError'
}

/** The server rejected the stored credentials (revoked app password, expired Google grant): only a new sign-in helps. */
export class AuthError extends AppError {
  override name = 'AuthError'
}

/** The server refused the request for its rate limit, so it was not processed and any method may run again. */
export type RateLimited = (res: Response) => boolean | Promise<boolean>

/**
 * Runs `send` again after a transient failure, `http.retries` times, with jittered exponential backoff: rate limited
 * (`limited`, by default 429) for any method; no response or a 5xx only for GET, since a write may have reached the
 * server and must not run twice. A timeout is not retried: it would multiply the wait for a server that is hanging.
 */
export async function withRetry(method: string, send: () => Promise<Response>, limited: RateLimited = (res) => res.status === 429): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const pause = (): Promise<void> => new Promise((r) => setTimeout(r, http.backoffMs * 2 ** attempt * (0.5 + Math.random())))
    let res: Response
    try {
      res = await send()
    } catch (e) {
      if (attempt >= http.retries || method !== 'GET' || e instanceof TimeoutError) throw e
      await pause()
      continue
    }
    if (attempt >= http.retries || !((method === 'GET' && res.status >= 500) || (await limited(res)))) return res
    await res.body?.cancel().catch(() => {}) // an unread body holds its connection until GC
    await pause()
  }
}
