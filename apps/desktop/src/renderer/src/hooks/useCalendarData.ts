import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Account, Calendar, CalEvent, TimeRange } from '@shared/types'
import { key } from '@mysticals/core/logic/visible'
import { Effect, Result } from 'effect'
import { live } from '@mysticals/core/sync/live'
import { bus } from '../bus'
import { ipc } from '../ipc'

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
let stop: (() => void) | undefined

const set = (d: Directory): void => {
  dir = d
  subs.forEach((f) => f())
}

const loadDirectory = Effect.all([ipc.api.accounts.list(), ipc.api.calendars.list()], { concurrency: 'unbounded' })

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  // live() interrupts a reload a newer one overtakes, so a slow answer can't overwrite a newer one.
  stop ??= live(window.api.onChanged, loadDirectory, (r) =>
    Result.isSuccess(r)
      ? set({ accounts: r.success[0], calendars: withInflight(r.success[1]), loaded: true })
      : console.error('useCalendarData: load failed', r.failure)
  )
  return () => {
    subs.delete(cb)
    if (subs.size) return
    stop?.()
    stop = undefined
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
  const settle = (): boolean => {
    if (inflight.get(k) !== visible) return false // a newer toggle owns this calendar now
    inflight.delete(k)
    return true
  }
  Effect.runFork(
    ipc.api.calendars.setVisible(accountId, calendarId, visible).pipe(
      Effect.tap(() => Effect.sync(settle)),
      Effect.catch((e) =>
        Effect.sync(() => {
          console.error(e)
          if (settle()) bus.emit('calendars:visible', { accountId, calendarId, visible: !visible })
        })
      )
    )
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
    return live(window.api.onChanged, ipc.api.events.list({ start, end }), (r) =>
      Result.isSuccess(r) ? setEvents(r.success) : console.error('useCalendarData: load failed', r.failure)
    )
  }, [start, end])

  // Until calendars load, hidden ones are unknown: hold events back so they can't flash in.
  return { ...shared, events: shared.loaded ? events : NONE }
}
