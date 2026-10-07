import { useSyncExternalStore } from 'react'
import { isSameDay, startOfDay } from 'date-fns'
import type { View } from '@mysticals/core/logic/layout'

/** Calendar views plus the desktop-only agenda (today's list with one-click join). */
export type DeskView = View | 'agenda'

/** Current date + view, shared by CalendarView and the sidebar mini-month. */
export interface NavState {
  date: Date
  view: DeskView
}

let state: NavState = { date: new Date(), view: 'week' }
const subs = new Set<() => void>()

export const nav = {
  get: (): NavState => state,
  set(patch: Partial<NavState>): void {
    // The agenda always opens on today; ‹ › then step through other days.
    if (patch.view === 'agenda' && state.view !== 'agenda' && !patch.date) patch = { ...patch, date: new Date() }
    state = { ...state, ...patch }
    subs.forEach((f) => f())
  }
}

// The calendar day the app last saw. A window left open (or brought back from the dock) across midnight would
// otherwise keep showing yesterday.
let day = startOfDay(new Date())

/** On a new calendar day, a view that was on today follows it; one stepped away to another date stays put. */
export function rollover(now = new Date()): void {
  if (isSameDay(now, day)) return
  const wasToday = isSameDay(state.date, day)
  day = startOfDay(now)
  if (wasToday) nav.set({ date: now })
}

if (typeof window !== 'undefined') {
  const check = (): void => rollover()
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
  setInterval(check, 60_000)
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export const useNav = (): NavState => useSyncExternalStore(subscribe, nav.get)
