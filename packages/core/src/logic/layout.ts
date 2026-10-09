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
import { awaitsReply } from './details'
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
 * chips in the all-day row, or ordinary blocks. `cascade` overlaps every block instead of
 * sharing lanes, each later one shifted right and drawn on top; it has no threshold.
 */
export type LongMode = 'rails' | 'allday' | 'cascade' | 'expand'
export interface LongEvents {
  mode: LongMode
  /** An event is long when its part on a day is longer than this. */
  hours: number
}
export const LONG_MODES: readonly LongMode[] = ['rails', 'allday', 'cascade', 'expand']
/** Modes that use the length threshold. */
export const usesThreshold = (mode: LongMode): boolean => mode === 'rails' || mode === 'allday'
/** The threshold's slider: from 1 to 12 hours in half-hour steps. */
export const LONG_RANGE = { min: 1, max: 12, step: 0.5 } as const
export const LONG_DEFAULT: LongEvents = { mode: 'rails', hours: 6 }
/** A stored or dragged threshold, clamped to LONG_RANGE and rounded to its step; garbage gives the default. */
export function snapLongHours(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return LONG_DEFAULT.hours
  const { min, max, step } = LONG_RANGE
  return Math.min(max, Math.max(min, Math.round(n / step) * step))
}

export interface DayLayout {
  /**
   * Ordinary blocks; `inset` is how many rail lanes sit to their left. In cascade mode each block
   * is full width (`cols` 1) with `level` steps of indent, in paint order (later on top).
   */
  timed: (Placed<CalEvent> & { inset: number; level?: number })[]
  rails: Placed<CalEvent>[]
  /** Long events moved to the all-day row, with their part of the day. */
  allDay: { item: CalEvent; start: number; end: number }[]
  /** Merged spans of the long events, for the busy hatch. */
  busy: { start: number; end: number }[]
}

/** layoutDay, with long events split off per `long.mode`. */
export function layoutDayLong(events: CalEvent[], day: Date, minDur: number, long: LongEvents): DayLayout {
  const items = clipDay(events, day)
  if (long.mode === 'cascade') return { timed: cascade(items, minDur), rails: [], allDay: [], busy: [] }
  const isLong = (it: { start: number; end: number }): boolean => usesThreshold(long.mode) && it.end - it.start > long.hours * 60
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

/** Earlier (and, at the same start, longer) blocks first; each one indents one step past the deepest it overlaps. */
function cascade(items: { item: CalEvent; start: number; end: number }[], minDur: number): DayLayout['timed'] {
  const out: (DayLayout['timed'][number] & { last: number })[] = []
  for (const it of [...items].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const level = out.filter((p) => p.start < Math.max(it.end, it.start + minDur) && it.start < p.last).reduce((m, p) => Math.max(m, p.level! + 1), 0)
    out.push({ ...it, col: 0, cols: 1, span: 1, inset: 0, level, last: Math.max(it.end, it.start + minDur) })
  }
  return out.map(({ last: _, ...p }) => p)
}

/**
 * Side-by-side blocks stay readable in up to `fit` columns. A cluster with more keeps its first `fit - 1` columns
 * (blocks there stop short of the last one); the blocks from there on make way for a "+N" in the last column, one per
 * run of them that overlap (`minDur` as in packColumns).
 */
export function fitColumns<P extends Placed<unknown>>(
  placed: P[],
  fit: number,
  minDur = 0
): { shown: P[]; more: { start: number; end: number; items: P[] }[] } {
  const shown: P[] = []
  const more: { start: number; end: number; items: P[] }[] = []
  for (const p of placed) {
    if (p.cols <= fit) shown.push(p)
    else if (p.col < fit - 1) shown.push({ ...p, cols: fit, span: Math.min(p.span, fit - 1 - p.col) })
  }
  const hidden = placed.filter((p) => p.cols > fit && p.col >= fit - 1).sort((a, b) => a.start - b.start)
  for (const p of hidden) {
    const end = Math.max(p.end, p.start + minDur)
    const last = more[more.length - 1]
    if (last && p.start < last.end) {
      last.end = Math.max(last.end, end)
      last.items.push(p)
    } else more.push({ start: p.start, end, items: [p] })
  }
  return { shown, more }
}

/**
 * How many of a month cell's `n` events it lists, `height` px tall (its clientHeight; base.css `.mg-*`): 4px padding,
 * the 21px date, then 18px rows 2px apart. When they don't all fit, "+N more" (16px) takes the last row; at least one
 * event shows.
 */
export function monthShown(height: number, n: number): number {
  const room = height - 29
  return n * 20 <= room ? n : Math.max(1, Math.floor((room - 18) / 20))
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
  if (awaitsReply(e)) return ' is-pending'
  if (e.myStatus === 'declined') return ' is-declined'
  return ''
}

export const ymd = (d: Date): string => format(d, 'yyyy-MM-dd')
