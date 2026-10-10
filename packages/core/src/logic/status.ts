import { differenceInMinutes } from 'date-fns'
import { fmt, t, type Locale } from '../i18n'
import type { CalEvent } from '../shared/types'
import { timePattern } from './clock'

/** Timed, non-declined events happening now (sorted by start) and the earliest one starting later. */
export function pickNowNext(events: CalEvent[], now: Date): { current: CalEvent[]; next?: CalEvent } {
  const t = now.getTime()
  const timed = events
    .filter((e) => !e.allDay && e.myStatus !== 'declined')
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return {
    current: timed.filter((e) => Date.parse(e.start) <= t && t < Date.parse(e.end)),
    next: timed.find((e) => Date.parse(e.start) > t)
  }
}

/** "in 25m" within the hour, otherwise "at 14:00" (or "at 2:00 PM" with `hour12`). */
export function startsLabel(start: string, now: Date, locale: Locale = 'en', hour12 = false): string {
  const s = new Date(start)
  const m = differenceInMinutes(s, now, { roundingMethod: 'ceil' })
  return m <= 60 ? t(locale, 'status.inMinutes', { n: m }) : t(locale, 'status.at', { time: fmt(locale, s, timePattern(hour12)) })
}
