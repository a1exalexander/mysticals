import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useStdout } from 'ink'
import { addDays, addWeeks, startOfDay } from 'date-fns'
import { shiftDate, viewRange } from '@multicals/core/logic/layout'
import { visibleEvents } from '@multicals/core/logic/visible'
import type { Account, Calendar, CalEvent, TimeRange } from '@multicals/core/shared/types'
import type { ClientApi } from '../client'

export const ApiContext = createContext<ClientApi | null>(null)

export function useApi(): ClientApi {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi outside <ApiContext.Provider>')
  return api
}

/** Stable id across accounts (provider event ids are only unique within their calendar). */
export const eventKey = (e: Pick<CalEvent, 'accountId' | 'calendarId' | 'id'>): string =>
  `${e.accountId}/${e.calendarId}/${e.id}`

/** Runs `load` now and whenever any account changes; drops stale responses. */
function useLive<T>(load: (api: ClientApi) => Promise<T>, deps: unknown[]): { data?: T; error?: string; reload(): void } {
  const api = useApi()
  const [state, setState] = useState<{ data?: T; error?: string }>({})
  const [bump, setBump] = useState(0)
  useEffect(() => {
    let seq = 0
    let alive = true
    const run = (): void => {
      const my = ++seq
      load(api).then(
        (data) => alive && my === seq && setState({ data }),
        (e: unknown) => alive && my === seq && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }))
      )
    }
    run()
    const off = api.onChanged(run)
    return () => {
      alive = false
      off()
    }
  }, [api, bump, ...deps])
  return { ...state, reload: useCallback(() => setBump((b) => b + 1), []) }
}

export interface Directory {
  accounts: Account[]
  calendars: Calendar[]
  loaded: boolean
  error?: string
  reload(): void
}

/** Accounts + calendars (hidden ones included, see `visible`); reloads on every change push. */
export function useDirectory(): Directory {
  const { data, error, reload } = useLive((api) => Promise.all([api.accounts.list(), api.calendars.list()]), [])
  return { accounts: data?.[0] ?? [], calendars: data?.[1] ?? [], loaded: !!data, error, reload }
}

/** Events in `range` from visible calendars only; reloads on every change push. */
export function useEvents(range: TimeRange): { events: CalEvent[]; loaded: boolean; error?: string; reload(): void } {
  const { data, error, reload } = useLive(
    async (api) => {
      const [events, calendars] = await Promise.all([api.events.list(range), api.calendars.list()])
      return visibleEvents(events, calendars)
    },
    [range.start, range.end]
  )
  return { events: data ?? [], loaded: !!data, error, reload }
}

export type View = 'agenda' | 'day' | 'week' | 'month'
export interface Nav {
  view: View
  /** Anchor day; views derive their visible days from it. */
  date: Date
}

export const AGENDA_DAYS = 14

/** Time range a view loads: agenda = AGENDA_DAYS from the anchor day, others per core `viewRange`. */
export function navRange({ view, date }: Nav): TimeRange {
  if (view !== 'agenda') return viewRange(view, date)
  const start = startOfDay(date)
  return { start: start.toISOString(), end: addDays(start, AGENDA_DAYS).toISOString() }
}

/** Next/previous page: agenda moves a week, other views per core `shiftDate`. */
export const shiftNav = ({ view, date }: Nav, dir: 1 | -1): Nav => ({
  view,
  date: view === 'agenda' ? addWeeks(date, dir) : shiftDate(view, date, dir)
})

export function useNav(initial: Nav = { view: 'agenda', date: new Date() }): {
  nav: Nav
  setView(view: View): void
  setDate(date: Date): void
  shift(dir: 1 | -1): void
  today(): void
} {
  const [nav, setNav] = useState(initial)
  return {
    nav,
    setView: useCallback((view: View) => setNav((n) => ({ ...n, view })), []),
    setDate: useCallback((date: Date) => setNav((n) => ({ ...n, date })), []),
    shift: useCallback((dir: 1 | -1) => setNav((n) => shiftNav(n, dir)), []),
    today: useCallback(() => setNav((n) => ({ ...n, date: new Date() })), [])
  }
}

/** Current time, refreshed every `ms` (drives "now" markers and the status line). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * Props every calendar view (views/{Agenda,Day,Week,Month}.tsx) receives from the App shell.
 * The shell owns navigation and selection keys; a view only renders and reports clicks-by-key via callbacks.
 */
export interface ViewProps {
  /** Visible-calendar events of `navRange(nav)`, unsorted (use core `eventsOnDay` to group/sort). */
  events: CalEvent[]
  /** Nav anchor day (`nav.date`). */
  date: Date
  now: Date
  /** `eventKey()` of the selected event, if any. */
  selectedKey?: string
  onSelect(e: CalEvent): void
  onOpen(e: CalEvent): void
  /** Columns/rows available to the view (header + status line already subtracted). */
  width: number
  height: number
}

/** Terminal size, updated on resize. Falls back to 80x24 when stdout is not a TTY. */
export function useTermSize(): { width: number; height: number } {
  const { stdout } = useStdout()
  const read = (): { width: number; height: number } => ({ width: stdout.columns || 80, height: stdout.rows || 24 })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const on = (): void => setSize(read())
    stdout.on('resize', on)
    return () => void stdout.off('resize', on)
  }, [stdout])
  return size
}
