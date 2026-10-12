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
    if (timeout.aborted) throw new Error(`Request to ${new URL(String(input instanceof Request ? input.url : input)).host} timed out`)
    throw e
  }
}

/** The server rejected the stored credentials (revoked app password, expired Google grant): only a new sign-in helps. */
export class AuthError extends Error {
  override name = 'AuthError'
}

/**
 * Worth another try: rate limited (429) for any method; no response or a 5xx only for GET, since a write may have
 * reached the server and must not run twice.
 */
const transient = (method: string, status?: number): boolean =>
  status === 429 || (method === 'GET' && (status === undefined || status >= 500))

/**
 * Runs `send` again after a transient failure, `http.retries` times, with jittered exponential backoff.
 * A timeout is not retried: it would multiply the wait for a server that is hanging.
 */
export async function withRetry(method: string, send: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const pause = (): Promise<void> => new Promise((r) => setTimeout(r, http.backoffMs * 2 ** attempt * (0.5 + Math.random())))
    let res: Response
    try {
      res = await send()
    } catch (e) {
      if (attempt >= http.retries || !transient(method) || /timed out/.test((e as Error).message)) throw e
      await pause()
      continue
    }
    if (attempt >= http.retries || !transient(method, res.status)) return res
    await pause()
  }
}
