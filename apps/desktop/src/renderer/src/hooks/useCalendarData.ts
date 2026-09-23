import { useEffect, useState } from 'react'
import type { Account, Calendar, CalEvent, TimeRange } from '@shared/types'

export interface CalendarData {
  accounts: Account[]
  calendars: Calendar[]
  events: CalEvent[]
}

const EMPTY: CalendarData = { accounts: [], calendars: [], events: [] }

/** Accounts, calendars and (when `range` is given) events; reloads whenever any account changes. */
export function useCalendarData(range?: TimeRange): CalendarData {
  const [data, setData] = useState(EMPTY)
  const start = range?.start
  const end = range?.end

  useEffect(() => {
    const { api } = window
    let seq = 0
    let alive = true
    const load = async (): Promise<void> => {
      const my = ++seq
      try {
        const [accounts, calendars, events] = await Promise.all([
          api.accounts.list(),
          api.calendars.list(),
          start && end ? api.events.list({ start, end }) : Promise.resolve([])
        ])
        // Drop stale responses so a slow reload can't overwrite a newer one.
        if (alive && my === seq) setData({ accounts, calendars, events })
      } catch (e) {
        console.error('useCalendarData: load failed', e)
      }
    }
    void load()
    const off = api.onChanged(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [start, end])

  return data
}
