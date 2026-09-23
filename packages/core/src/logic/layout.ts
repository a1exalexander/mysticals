import {
  addDays,
  addMonths,
  addWeeks,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import type { CalEvent, TimeRange } from '../shared/types'

// ponytail: Monday week start is hardcoded; move to settings when someone needs Sunday.
export const WEEK_STARTS_ON = 1 as const
export const SLOT_MIN = 15
export type View = 'day' | '3day' | 'week' | 'month'

/** Parsed bounds; all-day end is exclusive, zero/negative lengths are widened so the event still shows. */
export function eventBounds(e: CalEvent): { start: Date; end: Date } {
  const start = parseISO(e.start)
  let end = parseISO(e.end)
  if (end <= start) end = e.allDay ? addDays(start, 1) : new Date(start.getTime() + 60_000)
  return { start, end }
}

/** Ended at or before `now`; all-day events end at local midnight after their last day. */
export const isPast = (e: CalEvent, now: Date | number): boolean => eventBounds(e).end.getTime() <= +now

export function overlapsDay(e: CalEvent, day: Date): boolean {
  const d0 = startOfDay(day)
  const { start, end } = eventBounds(e)
  return start < addDays(d0, 1) && end > d0
}

/** Events touching `day`: all-day first, then by start time, longer first. */
export function eventsOnDay(events: CalEvent[], day: Date): CalEvent[] {
  return events
    .filter((e) => overlapsDay(e, day))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      const x = eventBounds(a), y = eventBounds(b)
      return x.start.getTime() - y.start.getTime() || y.end.getTime() - x.end.getTime()
    })
}

export interface Placed<T> {
  item: T
  /** Minutes from local midnight. */
  start: number
  end: number
  col: number
  cols: number
}

/**
 * Side-by-side packing: transitively overlapping items form a cluster; each item takes the
 * first free column. `minDur` treats very short items as taller so their blocks don't overlap.
 */
export function packColumns<T>(items: { item: T; start: number; end: number }[], minDur = 0): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed<T>[] = []
  let cluster: Placed<T>[] = []
  let colEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = (): void => {
    for (const p of cluster) p.cols = colEnds.length
    cluster = []
    colEnds = []
  }
  for (const it of sorted) {
    const end = Math.max(it.end, it.start + minDur)
    if (it.start >= clusterEnd) flush()
    let col = colEnds.findIndex((e) => e <= it.start)
    if (col < 0) col = colEnds.push(end) - 1
    else colEnds[col] = end
    clusterEnd = Math.max(clusterEnd, end)
    const p = { ...it, col, cols: 0 }
    cluster.push(p)
    out.push(p)
  }
  flush()
  return out
}

const wallMinutes = (d: Date): number => d.getHours() * 60 + d.getMinutes()

/** Timed events of one day, clipped to the day (wall-clock minutes, DST-safe) and packed. */
export function layoutDay(events: CalEvent[], day: Date, minDur = 0): Placed<CalEvent>[] {
  const items = events
    .filter((e) => !e.allDay && overlapsDay(e, day))
    .map((e) => {
      const { start, end } = eventBounds(e)
      return {
        item: e,
        start: isSameDay(start, day) ? wallMinutes(start) : 0,
        end: isSameDay(end, day) ? wallMinutes(end) : 1440
      }
    })
  return packColumns(items, minDur)
}

/** 6-week grid (42 days) covering the month of `date`. */
export function monthGrid(date: Date): Date[] {
  const first = startOfWeek(startOfMonth(date), { weekStartsOn: WEEK_STARTS_ON })
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

export function viewDays(view: View, date: Date): Date[] {
  if (view === 'month') return monthGrid(date)
  if (view === 'day') return [startOfDay(date)]
  if (view === '3day') return [0, 1, 2].map((i) => addDays(startOfDay(date), i))
  const first = startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON })
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

export function viewRange(view: View, date: Date): TimeRange {
  const days = viewDays(view, date)
  return { start: days[0].toISOString(), end: addDays(days[days.length - 1], 1).toISOString() }
}

export function shiftDate(view: View, date: Date, dir: 1 | -1): Date {
  if (view === 'day') return addDays(date, dir)
  if (view === '3day') return addDays(date, 3 * dir)
  if (view === 'week') return addWeeks(date, dir)
  return addMonths(date, dir)
}

/** "23 – 25 Sep 2026", "30 Sep – 2 Oct 2026", "30 Dec 2026 – 1 Jan 2027". */
export function rangeLabel(a: Date, b: Date): string {
  const head = a.getFullYear() !== b.getFullYear() ? 'd MMM yyyy' : a.getMonth() !== b.getMonth() ? 'd MMM' : 'd'
  return `${format(a, head)} – ${format(b, 'd MMM yyyy')}`
}

/** Floor a minute offset to its slot, clamped to the day. */
export function slotAt(minute: number): number {
  return Math.min(1440 - SLOT_MIN, Math.max(0, Math.floor(minute / SLOT_MIN) * SLOT_MIN))
}

/** Range covered by dragging from slot `a` to slot `b` (either direction), inclusive of both slots. */
export function dragRange(a: number, b: number): { start: number; end: number } {
  return { start: Math.min(a, b), end: Math.max(a, b) + SLOT_MIN }
}

/** CSS modifier for invite state: pending invites are striped, declined ones faded. */
export function statusClass(e: CalEvent): string {
  if (e.myStatus === 'needsAction') return ' is-pending'
  if (e.myStatus === 'declined') return ' is-declined'
  return ''
}

export const ymd = (d: Date): string => format(d, 'yyyy-MM-dd')
