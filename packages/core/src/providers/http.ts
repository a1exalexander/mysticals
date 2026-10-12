import { Context, Duration, Effect, Schedule } from 'effect'
import { HttpError, TimeoutError, messageOf } from '../errors'

/** Per-request budget (headers + body). Tests shorten it with `Effect.provideService(HttpTimeout, ...)`. */
export const HttpTimeout = Context.Reference<Duration.Input>('mysticals/HttpTimeout', { defaultValue: () => Duration.seconds(30) })

/** Extra attempts for a transient failure (see `retryTransient`). */
export const HttpRetries = Context.Reference<number>('mysticals/HttpRetries', { defaultValue: () => 2 })

const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : url)

/**
 * One `fetch` plus `read` of its body, failing with TimeoutError after `HttpTimeout` (so one hung server can't keep a
 * sync running forever) and HttpError when there's no response. Interrupting it aborts the request; the caller's own
 * `init.signal` still aborts it too. `fetch` is looked up per call, so tests can stub the global.
 */
export const request = <A = Response>(
  url: string,
  init: RequestInit = {},
  read: (res: Response) => Promise<A> = async (res) => res as A
): Effect.Effect<A, HttpError | TimeoutError> =>
  Effect.flatMap(HttpTimeout, (budget) =>
    Effect.tryPromise({
      try: async (interrupted) => {
        const timeout = AbortSignal.timeout(Duration.toMillis(Duration.fromInputUnsafe(budget)))
        const signals = [interrupted, timeout, ...(init.signal ? [init.signal] : [])]
        try {
          return await read(await fetch(url, { ...init, signal: AbortSignal.any(signals) }))
        } catch (e) {
          if (timeout.aborted) throw new TimeoutError({ message: `Request to ${hostOf(url)} timed out` })
          throw e
        }
      },
      catch: (e) => (e instanceof TimeoutError ? e : new HttpError({ message: messageOf(e) }))
    })
  )

/**
 * Worth another try: rate limited (429) for any method; no response or a 5xx only for GET, since a write may have
 * reached the server and must not run twice.
 */
const transient = (method: string) => (e: { readonly _tag: string; readonly status?: number }): boolean =>
  e._tag === 'HttpError' && (e.status === 429 || (method === 'GET' && (e.status === undefined || e.status >= 500)))

/** Retries `self` on transient failures with jittered exponential backoff, `HttpRetries` times. */
export const retryTransient =
  (method: string) =>
  <A, E extends { readonly _tag: string; readonly status?: number }, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(HttpRetries, (times) =>
      Effect.retry(self, { times, while: transient(method), schedule: Schedule.exponential('500 millis').pipe(Schedule.jittered) })
    )

/**
 * A plain `fetch` for promise-based libraries (tsdav), running `request` with the current fiber's services so the
 * caller's `HttpTimeout` applies. `check` sees every response first and may fail it (e.g. 401 -> AuthError).
 */
export const fetchFor = <E>(
  check: (res: Response) => Effect.Effect<Response, E> = Effect.succeed as never
): Effect.Effect<typeof fetch> =>
  Effect.map(Effect.context<never>(), (services) => {
    const run = Effect.runPromiseWith(services)
    return (input: RequestInfo | URL, init?: RequestInit) =>
      run(Effect.flatMap(request(input instanceof Request ? input.url : String(input), init), check))
  })
