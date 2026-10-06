import { useSyncExternalStore } from 'react'
import { LONG_DEFAULT, LONG_MODES, snapLongHours, type LongEvents } from '@mysticals/core/logic/layout'

/** How long timed events show in the day grid; a per-device display preference, like the theme. */
const KEY = 'mysticals-long-events'

function read(): LongEvents {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LongEvents> | null
    return {
      mode: LONG_MODES.includes(v?.mode as LongEvents['mode']) ? (v?.mode as LongEvents['mode']) : LONG_DEFAULT.mode,
      hours: snapLongHours(v?.hours)
    }
  } catch {
    // storage unavailable or garbled: fall back to default
    return LONG_DEFAULT
  }
}

let current = read()
const subs = new Set<() => void>()

export function setLongEvents(next: Partial<LongEvents>): void {
  current = { ...current, ...next }
  current.hours = snapLongHours(current.hours)
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // per-device preference only; ignore
  }
  subs.forEach((f) => f())
}

export const useLongEvents = (): LongEvents =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => current
  )
