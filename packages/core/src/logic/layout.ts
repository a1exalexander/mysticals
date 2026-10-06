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
import { fmt, type Locale } from '../i18n'
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
  /** Columns the item covers from `col`: it widens into neighbours that are free for its whole span. */
  span: number
}

/**
 * Side-by-side packing: transitively overlapping items form a cluster; each item takes the
 * first free column, then widens to the right over columns free for its whole span.
 * `minDur` treats very short items as taller so their blocks don't overlap.
 */
export function packColumns<T>(items: { item: T; start: number; end: number }[], minDur = 0): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed<T>[] = []
  let cluster: { p: Placed<T>; end: number }[] = []
  let colEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = (): void => {
    for (const { p, end } of cluster) {
      p.cols = colEnds.length
      const busy = (col: number): boolean => cluster.some((q) => q.p.col === col && q.p.start < end && p.start < q.end)
      while (p.col + p.span < p.cols && !busy(p.col + p.span)) p.span++
    }
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
    const p = { ...it, col, cols: 0, span: 1 }
    cluster.push({ p, end })
    out.push(p)
  }
  flush()
  return out
}

const wallMinutes = (d: Date): number => d.getHours() * 60 + d.getMinutes()

/** Timed events of one day, clipped to the day (wall-clock minutes, DST-safe). */
function clipDay(events: CalEvent[], day: Date): { item: CalEvent; start: number; end: number }[] {
  return events
    .filter((e) => !e.allDay && overlapsDay(e, day))
    .map((e) => {
      const { start, end } = eventBounds(e)
      return {
        item: e,
        start: isSameDay(start, day) ? wallMinutes(start) : 0,
        end: isSameDay(end, day) ? wallMinutes(end) : 1440
      }
    })
}

/** Timed events of one day, clipped to the day and packed. */
export function layoutDay(events: CalEvent[], day: Date, minDur = 0): Placed<CalEvent>[] {
  return packColumns(clipDay(events, day), minDur)
}

/**
 * How timed events longer than a threshold show in the day grid: thin rails at the left edge,
 * chips in the all-day row, or ordinary blocks.
 */
export type LongMode = 'rails' | 'allday' | 'expand'
export interface LongEvents {
  mode: LongMode
  /** An event is long when its part on a day is longer than this. */
  hours: number
}
export const LONG_MODES: readonly LongMode[] = ['rails', 'allday', 'expand']
export const LONG_HOURS = [3, 4, 5, 6, 8, 10, 12] as const
export const LONG_DEFAULT: LongEvents = { mode: 'rails', hours: 6 }

export interface DayLayout {
  /** Ordinary blocks; `inset` is how many rail lanes sit to their left. */
  timed: (Placed<CalEvent> & { inset: number })[]
  rails: Placed<CalEvent>[]
  /** Long events moved to the all-day row, with their part of the day. */
  allDay: { item: CalEvent; start: number; end: number }[]
  /** Merged spans of the long events, for the busy hatch. */
  busy: { start: number; end: number }[]
}

/** layoutDay, with long events split off per `long.mode`. */
export function layoutDayLong(events: CalEvent[], day: Date, minDur: number, long: LongEvents): DayLayout {
  const items = clipDay(events, day)
  const isLong = (it: { start: number; end: number }): boolean => long.mode !== 'expand' && it.end - it.start > long.hours * 60
  const longs = items.filter(isLong)
  const rails = long.mode === 'rails' ? packColumns(longs) : []
  const timed = packColumns(items.filter((it) => !isLong(it)), minDur).map((p) => {
    const end = Math.max(p.end, p.start + minDur)
    const over = rails.filter((r) => r.start < end && p.start < r.end)
    return { ...p, inset: over.length ? Math.max(...over.map((r) => r.cols)) : 0 }
  })
  const busy: { start: number; end: number }[] = []
  for (const it of [...longs].sort((a, b) => a.start - b.start)) {
    const last = busy[busy.length - 1]
    if (last && it.start <= last.end) last.end = Math.max(last.end, it.end)
    else busy.push({ start: it.start, end: it.end })
  }
  return { timed, rails, allDay: long.mode === 'allday' ? longs : [], busy }
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
export function rangeLabel(a: Date, b: Date, locale: Locale = 'en'): string {
  const head = a.getFullYear() !== b.getFullYear() ? 'd MMM yyyy' : a.getMonth() !== b.getMonth() ? 'd MMM' : 'd'
  return `${fmt(locale, a, head)} – ${fmt(locale, b, 'd MMM yyyy')}`
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
