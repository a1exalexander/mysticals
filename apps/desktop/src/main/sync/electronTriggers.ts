import { app, powerMonitor } from 'electron'

/** Default SyncEngine wake-ups: wake from sleep and window focus. */
export function electronTriggers(fire: () => void): () => void {
  powerMonitor.on('resume', fire)
  app.on('browser-window-focus', fire)
  return () => {
    powerMonitor.off('resume', fire)
    app.off('browser-window-focus', fire)
  }
}
