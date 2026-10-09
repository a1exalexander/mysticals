import { useSyncExternalStore } from 'react'
import type { ClockState } from '@shared/ipc'
import { hourPattern, timePattern, weekNumber, type TimeFormat, type WeekStart } from '@mysticals/core/logic/clock'
import { fmt } from './i18n'

// 24- or 12-hour times and the first day of the week come from the main process (Settings > General, else the
// OS region), like the language. The helpers read the current choice; components call `useClock()` so they
// re-render when it changes.

let state: ClockState = { timeFormat: 'auto', weekStart: 'auto', hour12: false, weekStartsOn: 1, system: { hour12: false, weekStartsOn: 1 } }
const subs = new Set<() => void>()

function apply(next: ClockState): void {
  state = next
  // CSS makes room for the longer "11:45 AM" where a time sits in a tight spot.
  document.documentElement.dataset.clock = next.hour12 ? '12' : '24'
  subs.forEach((f) => f())
}

/** Load the clock prefs before the first render, then follow changes. */
export async function initClock(): Promise<void> {
  try {
    apply(await window.clock.get())
  } catch {
    // no main-process handler (should not happen): stay 24-hour, Monday
  }
  window.clock.onChange(apply)
}

export const setClock = (patch: { timeFormat?: TimeFormat; weekStart?: WeekStart }): Promise<void> => window.clock.set(patch).then(apply)

export const hour12 = (): boolean => state.hour12
export const weekStartsOn = (): 0 | 1 => state.weekStartsOn
/** "14:05" or "2:05 PM". */
export const hm = (d: Date | number): string => fmt(d, timePattern(state.hour12))
/** A whole-hour label: "09:00" or "9 AM". */
export const hourLabel = (d: Date | number): string => fmt(d, hourPattern(state.hour12))
export const weekNo = (d: Date): number => weekNumber(d, state.weekStartsOn)

export const useClock = (): ClockState =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state
  )
