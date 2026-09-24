/** Per-request budget (headers + body). Mutable only so tests can shorten it. */
export const http = { timeoutMs: 30_000 }

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
