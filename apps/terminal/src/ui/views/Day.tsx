/**
 * Day and 2 Days views: 1 or 2 time-grid columns starting at `date`. See TimeGrid.
 *
 * Props: ViewProps (ui/hooks.ts). Keys: none of their own; the App shell owns them all.
 */
import { useMemo } from 'react'
import { addDays, startOfDay } from 'date-fns'
import type { ViewProps } from '../hooks'
import { TimeGrid } from './TimeGrid'

function useDays(date: Date, n: number): Date[] {
  const t = startOfDay(date).getTime()
  return useMemo(() => Array.from({ length: n }, (_, i) => addDays(t, i)), [t, n])
}

export const Day = (p: ViewProps) => <TimeGrid {...p} days={useDays(p.date, 1)} />
export const TwoDay = (p: ViewProps) => <TimeGrid {...p} days={useDays(p.date, 2)} />
