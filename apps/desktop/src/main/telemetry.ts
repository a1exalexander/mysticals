import { app } from 'electron'
import { Effect } from 'effect'
import { IPC } from '@shared/ipc'
import { startTelemetry } from '@mysticals/core/telemetry'
import { readPrefs, writePrefs } from './prefs'
import { handle, AnyArgs } from './ipc/register'

/** Settings > Privacy toggle; on unless the user turned it off. */
const allowed = (): boolean => readPrefs().telemetry !== false

/**
 * Serves the Settings toggle and starts telemetry (sends `app_installed` on first launch).
 * Off in dev (unpackaged) builds, without an embedded key, and under the env opt-outs (see core `telemetryOff`).
 */
export const startDesktopTelemetry = Effect.gen(function* () {
  yield* handle(IPC.telemetryGet, AnyArgs, () => Effect.sync(allowed))
  yield* handle(IPC.telemetrySet, AnyArgs, ([on]) => writePrefs({ telemetry: on === true }))
  const t = yield* startTelemetry({
    key: app.isPackaged ? import.meta.env.MYSTICALS_POSTHOG_KEY : '',
    app: 'desktop',
    version: app.getVersion(),
    dir: app.getPath('userData'),
    allowed
  })
  return t?.track
})
