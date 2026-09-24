import { useEffect, useState } from 'react'
import type { Account, Calendar, CalEvent, TimeRange } from '@shared/types'
import { key } from '@mysticals/core/logic/visible'
import { bus } from '../bus'

export interface CalendarData {
  accounts: Account[]
  calendars: Calendar[]
  events: CalEvent[]
  loaded: boolean
}

const EMPTY: CalendarData = { accounts: [], calendars: [], events: [], loaded: false }

// Visibility writes still in flight; applied over any reload so a stale list can't flip the checkbox back.
const inflight = new Map<string, boolean>()

const patch = (calendars: Calendar[], k: string, visible: boolean): Calendar[] =>
  calendars.map((c) => (key(c.accountId, c.id) === k ? { ...c, visible } : c))
const withInflight = (calendars: Calendar[]): Calendar[] =>
  [...inflight].reduce((cs, [k, v]) => patch(cs, k, v), calendars)

/** Optimistically shows/hides a calendar in every useCalendarData instance, then persists it; reverts on failure. */
export function setCalendarVisible(accountId: string, calendarId: string, visible: boolean): void {
  const k = key(accountId, calendarId)
  inflight.set(k, visible)
  bus.emit('calendars:visible', { accountId, calendarId, visible })
  const settle = (failed: boolean): void => {
    if (inflight.get(k) !== visible) return // a newer toggle owns this calendar now
    inflight.delete(k)
    if (failed) bus.emit('calendars:visible', { accountId, calendarId, visible: !visible })
  }
  window.api.calendars.setVisible(accountId, calendarId, visible).then(
    () => settle(false),
    (e) => {
      console.error(e)
      settle(true)
    }
  )
}

/** Accounts, calendars and (when `range` is given) events; reloads whenever any account changes. */
export function useCalendarData(range?: TimeRange): CalendarData {
  const [data, setData] = useState(EMPTY)
  const start = range?.start
  const end = range?.end

  useEffect(
    () =>
      bus.on('calendars:visible', ({ accountId, calendarId, visible }) =>
        setData((d) => ({ ...d, calendars: patch(d.calendars, key(accountId, calendarId), visible) }))
      ),
    []
  )

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
        if (alive && my === seq) setData({ accounts, calendars: withInflight(calendars), events, loaded: true })
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
