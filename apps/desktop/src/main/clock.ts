import { app } from 'electron'
import { Effect, Schema } from 'effect'
import { IPC, type ClockState } from '@shared/ipc'
import { isTimeFormat, isWeekStart, regionHour12, regionWeekStartsOn } from '@mysticals/core/logic/clock'
import { readPrefs, writePrefs } from './prefs'
import { handle, AnyArgs } from './ipc/register'
import { broadcast } from './window'

// Mock runs (e2e) see a 24-hour, Monday-first region so specs don't depend on the machine they run on.
const system = (): ClockState['system'] => {
  if (process.env.MYSTICALS_MOCK === '1') return { hour12: false, weekStartsOn: 1 }
  const region = app.getSystemLocale()
  return { hour12: regionHour12(region), weekStartsOn: regionWeekStartsOn(region) }
}

const state = (): ClockState => {
  const p = readPrefs()
  const timeFormat = isTimeFormat(p.timeFormat) ? p.timeFormat : 'auto'
  const weekStart = isWeekStart(p.weekStart) ? p.weekStart : 'auto'
  const sys = system()
  return {
    timeFormat,
    weekStart,
    hour12: timeFormat === 'auto' ? sys.hour12 : timeFormat === '12',
    weekStartsOn: weekStart === 'auto' ? sys.weekStartsOn : weekStart === 'sun' ? 0 : 1,
    system: sys
  }
}

let current: ClockState | undefined

/** 12-hour times in notifications. Valid after `startClock`. */
export const hour12 = (): boolean => current?.hour12 ?? false

const Patch = Schema.NullishOr(
  Schema.Struct({ timeFormat: Schema.optional(Schema.declare(isTimeFormat)), weekStart: Schema.optional(Schema.declare(isWeekStart)) })
)

/** The first bad field of a patch, as the UI has always been told. */
const invalid = ([patch]: unknown[]): string => {
  const { timeFormat, weekStart } = (patch ?? {}) as Record<string, unknown>
  return timeFormat !== undefined && !isTimeFormat(timeFormat) ? `unknown time format: ${String(timeFormat)}` : `unknown week start: ${String(weekStart)}`
}

/** Resolves Auto from the OS region and serves Settings > General time format and week start. Call after app ready and `loadPrefs`. */
export const startClock = Effect.gen(function* () {
  current = state()
  yield* handle(IPC.clockGet, AnyArgs, () => Effect.sync(() => current))
  yield* handle(
    IPC.clockSet,
    Schema.Tuple([Patch]),
    ([patch]) =>
      Effect.gen(function* () {
        const { timeFormat, weekStart } = patch ?? {}
        yield* writePrefs({ ...(timeFormat ? { timeFormat } : {}), ...(weekStart ? { weekStart } : {}) })
        current = state()
        broadcast(IPC.clock, current)
        return current
      }),
    invalid
  )
})
