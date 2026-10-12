import { randomUUID } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { LocaleSetting } from '@mysticals/core/i18n'
import type { TimeFormat, WeekStart } from '@mysticals/core/logic/clock'

/** App-wide preferences in `<userData>/prefs.json`. Every key is optional; absent means the default. */
export interface Prefs {
  telemetry?: boolean
  language?: LocaleSetting
  timeFormat?: TimeFormat
  weekStart?: WeekStart
  /** Minutes before an event its reminder pops up; 0 = off. */
  reminderMin?: number
  /** Accounts whose reminders and invite/change banners are off. */
  notifyOff?: string[]
  /** Full-screen reminder instead of a Banner for events with a Call link; off by default. */
  fullscreenReminder?: boolean
  /** A sound with each reminder; on by default. */
  reminderSound?: boolean
}

const prefsFile = (dir = app.getPath('userData')): string => join(dir, 'prefs.json')

/** Writes to a temp file then renames, so a crash mid-write never leaves a truncated file (lost settings). */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

/** Parsed prefs.json per file: read once, then kept up to date by writePrefs (the reminder tick reads it often). */
const cache = new Map<string, Prefs>()

export function readPrefs(dir?: string): Prefs {
  const file = prefsFile(dir)
  let prefs = cache.get(file)
  if (!prefs) {
    try {
      const v = JSON.parse(readFileSync(file, 'utf8'))
      prefs = v && typeof v === 'object' ? v : {}
    } catch {
      prefs = {}
    }
    cache.set(file, prefs!)
  }
  return { ...prefs }
}

/** Merges `patch` into the stored prefs, so one setting never wipes another. */
export function writePrefs(patch: Prefs, dir?: string): void {
  const next = { ...readPrefs(dir), ...patch }
  writeFileAtomic(prefsFile(dir), JSON.stringify(next))
  cache.set(prefsFile(dir), next)
}
