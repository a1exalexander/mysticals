import { useSyncExternalStore } from 'react'

/** Left sidebar shown or collapsed: a per-device preference, expanded by default. */
const KEY = 'mysticals-sidebar'

let collapsed = ((): boolean => {
  try {
    return localStorage.getItem(KEY) === 'collapsed'
  } catch {
    return false
  }
})()
const subs = new Set<() => void>()

export function toggleSidebar(): void {
  collapsed = !collapsed
  try {
    localStorage.setItem(KEY, collapsed ? 'collapsed' : 'expanded')
  } catch {
    // per-device preference only; ignore
  }
  subs.forEach((f) => f())
}

export const useSidebarCollapsed = (): boolean =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => collapsed
  )
