import { Data } from 'effect'

/** The server rejected the stored credentials (revoked app password, expired Google grant): only a new sign-in helps. */
export class AuthError extends Data.TaggedError('AuthError')<{ readonly message: string }> {}

/** A request failed: no response (network), or a status the caller doesn't handle. `status` is absent without a response. */
export class HttpError extends Data.TaggedError('HttpError')<{ readonly message: string; readonly status?: number }> {}

/** A request outlived its budget (see `HttpTimeout`). */
export class TimeoutError extends Data.TaggedError('TimeoutError')<{ readonly message: string }> {}

/** Anything else the user is told about: a refused input, a missing account, a read-only calendar, a corrupt file. */
export class AppError extends Data.TaggedError('AppError')<{ readonly message: string }> {}

/** What a provider call can fail with. */
export type ProviderError = AuthError | HttpError | TimeoutError | AppError

export const fail = (message: string): AppError => new AppError({ message })

/** The user-facing text of any failure (typed error, defect or thrown value). */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))
