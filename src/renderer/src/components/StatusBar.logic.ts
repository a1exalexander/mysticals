import { differenceInMinutes, format } from 'date-fns'
import type { CalEvent } from '@shared/types'

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

/** "in 25m" within the hour, otherwise "at 14:00". */
export function startsLabel(start: string, now: Date): string {
  const s = new Date(start)
  const m = differenceInMinutes(s, now, { roundingMethod: 'ceil' })
  return m <= 60 ? `in ${m}m` : `at ${format(s, 'HH:mm')}`
}
