import { Effect } from 'effect'
import type { CoreApiEffect } from '@mysticals/core/api'
import { AppError } from '@mysticals/core/errors'
import { errorText } from '@mysticals/core/logic/editor'

/** A preload API's promise methods as Effects (subscriptions like `onChanged` stay on `window`). */
type Effects<T> = {
  [K in keyof T as T[K] extends (...a: never[]) => Promise<unknown> ? K : never]: T[K] extends (...a: infer A) => Promise<infer R>
    ? (...a: A) => Effect.Effect<R, AppError>
    : never
}

// Reads the preload object at call time: modules importing this load in unit tests without one, and a missing
// API (plain-browser preview) fails the Effect instead of throwing at import.
const wrap = <T>(get: () => T): Effects<T> =>
  new Proxy({} as Effects<T>, {
    get: (_, k) => (...a: unknown[]) =>
      Effect.tryPromise({
        try: () => (get() as Record<PropertyKey, (...a: unknown[]) => Promise<unknown>>)[k](...a),
        // IPC rejections carry Electron's "Error invoking remote method 'x': Error: " prefix; the UI shows the rest.
        catch: (e) => new AppError({ message: errorText(e) })
      })
  })

/** The preload APIs as Effects that fail with the user-facing message. */
export const ipc = {
  api: {
    accounts: wrap(() => window.api.accounts),
    calendars: wrap(() => window.api.calendars),
    events: wrap(() => window.api.events),
    sync: wrap(() => window.api.sync)
  } satisfies CoreApiEffect,
  update: wrap(() => window.update),
  telemetry: wrap(() => window.telemetry),
  locale: wrap(() => window.locale),
  clock: wrap(() => window.clock),
  reminders: wrap(() => window.reminders),
  reminderScreen: wrap(() => window.reminderScreen),
  appTheme: wrap(() => window.appTheme),
  logs: wrap(() => window.logs)
}
