import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Account, Calendar, CalEvent, TimeRange } from '@shared/types'
import { key } from '@mysticals/core/logic/visible'
import { bus } from '../bus'

export interface Directory {
  accounts: Account[]
  calendars: Calendar[]
  loaded: boolean
}

export interface CalendarData extends Directory {
  events: CalEvent[]
}

const NONE: CalEvent[] = []

// Visibility writes still in flight; applied over any reload so a stale list can't flip the checkbox back.
const inflight = new Map<string, boolean>()

const patch = (calendars: Calendar[], k: string, visible: boolean): Calendar[] =>
  calendars.map((c) => (key(c.accountId, c.id) === k ? { ...c, visible } : c))
const withInflight = (calendars: Calendar[]): Calendar[] =>
  [...inflight].reduce((cs, [k, v]) => patch(cs, k, v), calendars)

// One accounts + calendars store for the whole window: a single onChanged listener and one reload per change,
// however many components read it.
let dir: Directory = { accounts: [], calendars: [], loaded: false }
const subs = new Set<() => void>()
let off: (() => void) | undefined
let seq = 0

const set = (d: Directory): void => {
  dir = d
  subs.forEach((f) => f())
}

async function load(): Promise<void> {
  const my = ++seq
  try {
    const [accounts, calendars] = await Promise.all([window.api.accounts.list(), window.api.calendars.list()])
    // Drop stale responses so a slow reload can't overwrite a newer one.
    if (off && my === seq) set({ accounts, calendars: withInflight(calendars), loaded: true })
  } catch (e) {
    console.error('useCalendarData: load failed', e)
  }
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  if (!off) {
    off = window.api.onChanged(() => void load())
    void load()
  }
  return () => {
    subs.delete(cb)
    if (subs.size) return
    off?.()
    off = undefined
  }
}

/** The store behind useDirectory; exported for tests. */
export const directory = { get: (): Directory => dir, subscribe }

bus.on('calendars:visible', ({ accountId, calendarId, visible }) =>
  set({ ...dir, calendars: patch(dir.calendars, key(accountId, calendarId), visible) })
)

/** Optimistically shows/hides a calendar for every reader of the directory, then persists it; reverts on failure. */
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

/** Accounts + calendars shared by every caller; reloads whenever any account changes. */
export const useDirectory = (): Directory => useSyncExternalStore(subscribe, directory.get)

/** The shared directory plus, when `range` is given, that range's events (reloaded on every change). */
export function useCalendarData(range?: TimeRange): CalendarData {
  const shared = useDirectory()
  const [events, setEvents] = useState(NONE)
  const start = range?.start
  const end = range?.end

  useEffect(() => {
    if (!start || !end) return
    const { api } = window
    let seq = 0
    let alive = true
    const load = async (): Promise<void> => {
      const my = ++seq
      try {
        const evs = await api.events.list({ start, end })
        // Drop stale responses so a slow reload can't overwrite a newer one.
        if (alive && my === seq) setEvents(evs)
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

  // Until calendars load, hidden ones are unknown: hold events back so they can't flash in.
  return { ...shared, events: shared.loaded ? events : NONE }
}
