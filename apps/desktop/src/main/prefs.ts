import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { LocaleSetting } from '@mysticals/core/i18n'

/** App-wide preferences in `<userData>/prefs.json`. Every key is optional; absent means the default. */
export interface Prefs {
  telemetry?: boolean
  language?: LocaleSetting
  /** Minutes before an event its reminder pops up; 0 = off. */
  reminderMin?: number
  /** Accounts whose reminders and invite/change banners are off. */
  notifyOff?: string[]
  /** Full-screen reminder instead of a Banner for events with a Call link; off by default. */
  fullscreenReminder?: boolean
}

const prefsFile = (dir = app.getPath('userData')): string => join(dir, 'prefs.json')

export function readPrefs(dir?: string): Prefs {
  try {
    const v = JSON.parse(readFileSync(prefsFile(dir), 'utf8'))
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Merges `patch` into the stored prefs, so one setting never wipes another. */
export function writePrefs(patch: Prefs, dir?: string): void {
  writeFileSync(prefsFile(dir), JSON.stringify({ ...readPrefs(dir), ...patch }))
}
