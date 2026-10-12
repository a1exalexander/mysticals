import { join } from 'path'
import { Effect, Ref, Semaphore, type FileSystem } from 'effect'
import { readJson, writeAtomic } from '@mysticals/core/accounts/store'
import type { AppError } from '@mysticals/core/errors'
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

// Read once at startup, then served from memory: the reminders tick alone reads several keys every 20 s.
const cache = Ref.makeUnsafe<Prefs>({})
let file = ''
// One write at a time, each of the latest prefs, so an older snapshot never lands after a newer one.
const lock = Semaphore.makeUnsafe(1)

/** Loads `<dir>/prefs.json` into memory; a missing or unreadable file means all defaults. Call before anything reads. */
export const loadPrefs = (dir: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    file = join(dir, 'prefs.json')
    const v = yield* readJson<unknown>(file, undefined).pipe(Effect.orElseSucceed(() => undefined))
    yield* Ref.set(cache, v && typeof v === 'object' ? (v as Prefs) : {})
  })

/** The prefs in memory (defaults until `loadPrefs`). */
export const readPrefs = (): Prefs => Ref.getUnsafe(cache)

/** Merges `patch` into the prefs, so one setting never wipes another; the file is replaced atomically. */
export const writePrefs = (patch: Prefs): Effect.Effect<void, AppError, FileSystem.FileSystem> =>
  Ref.update(cache, (p) => ({ ...p, ...patch })).pipe(
    Effect.andThen(Semaphore.withPermit(lock, Effect.suspend(() => writeAtomic(file, JSON.stringify(Ref.getUnsafe(cache))))))
  )
