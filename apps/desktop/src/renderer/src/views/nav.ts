import { useSyncExternalStore } from 'react'
import type { View } from './layout'

/** Current date + view, shared by CalendarView and the sidebar mini-month. */
export interface NavState {
  date: Date
  view: View
}

let state: NavState = { date: new Date(), view: 'week' }
const subs = new Set<() => void>()

export const nav = {
  get: (): NavState => state,
  set(patch: Partial<NavState>): void {
    state = { ...state, ...patch }
    subs.forEach((f) => f())
  }
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export const useNav = (): NavState => useSyncExternalStore(subscribe, nav.get)
