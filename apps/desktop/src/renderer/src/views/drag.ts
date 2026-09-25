import { addDays, format, parseISO } from 'date-fns'
import type { CalEvent } from '@shared/types'

/** Drag step in minutes. */
export const STEP = 15

/** Pointer minute snapped to the nearest step. */
export const snap = (min: number): number => Math.round(min / STEP) * STEP

/** `start..end` moved by `delta` minutes, kept whole and inside the day. */
export function moveRange(start: number, end: number, delta: number): { start: number; end: number } {
  const dur = end - start
  const s = Math.max(0, Math.min(start + snap(delta), 1440 - dur))
  return { start: s, end: s + dur }
}

/** New end when the bottom edge is dragged to `pointer`: at least one step long, at most midnight. */
export const resizeEnd = (start: number, pointer: number): number => Math.max(start + STEP, Math.min(1440, snap(pointer)))

/** The event moved by whole days, keeping its wall-clock times (all-day events stay date-only). */
export function shiftDays(e: Pick<CalEvent, 'start' | 'end' | 'allDay'>, days: number): { start: string; end: string } {
  if (e.allDay) {
    const d = (iso: string): string => format(addDays(parseISO(iso), days), 'yyyy-MM-dd')
    return { start: d(e.start), end: d(e.end) }
  }
  return { start: addDays(new Date(e.start), days).toISOString(), end: addDays(new Date(e.end), days).toISOString() }
}
