import { useSyncExternalStore } from 'react'
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

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export const useNav = (): NavState => useSyncExternalStore(subscribe, nav.get)
