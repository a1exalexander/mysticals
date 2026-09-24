import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { startTelemetry, type Track } from '@mysticals/core/telemetry'

const prefsFile = (): string => join(app.getPath('userData'), 'prefs.json')

/** Settings > Privacy toggle; on unless the user turned it off. */
function allowed(): boolean {
  try {
    return JSON.parse(readFileSync(prefsFile(), 'utf8')).telemetry !== false
  } catch {
    return true
  }
}

/**
 * Serves the Settings toggle and starts telemetry (sends `app_installed` on first launch).
 * Off in dev (unpackaged) builds, without an embedded key, and under the env opt-outs (see core `telemetryOff`).
 */
export function startDesktopTelemetry(): Track | undefined {
  ipcMain.handle(IPC.telemetryGet, allowed)
  ipcMain.handle(IPC.telemetrySet, (_e, on: unknown) => writeFileSync(prefsFile(), JSON.stringify({ telemetry: on === true })))
  return startTelemetry({
    key: app.isPackaged ? import.meta.env.MYSTICALS_POSTHOG_KEY : '',
    app: 'desktop',
    version: app.getVersion(),
    dir: app.getPath('userData'),
    allowed
  })?.track
}
