/**
 * Week view: 7-day time-grid table, Monday first (core `viewDays('week', date)`). See TimeGrid.
 *
 * Props: ViewProps (ui/hooks.ts). Keys: none of its own; the App shell owns them all.
 */
import { useMemo } from 'react'
import { viewDays } from '@mysticals/core/logic/layout'
import type { ViewProps } from '../hooks'
import { TimeGrid } from './TimeGrid'

export function Week(p: ViewProps) {
  const t = p.date.getTime()
  const days = useMemo(() => viewDays('week', new Date(t)), [t])
  return <TimeGrid {...p} days={days} />
}
