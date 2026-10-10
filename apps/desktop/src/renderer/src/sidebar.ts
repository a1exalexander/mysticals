import { useSyncExternalStore } from 'react'

/** Left sidebar shown or collapsed: a per-device preference, expanded by default. */
const KEY = 'mysticals-sidebar'
/** Its width, dragged on its edge (App.tsx); also per-device. */
const WIDTH_KEY = 'mysticals-sidebar-width'
export const SIDEBAR_DEFAULT = 240
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 400

/** Whole pixels within bounds; anything unreadable is the default. */
export const clampSidebarWidth = (px: number): number =>
  Number.isFinite(px) ? Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px))) : SIDEBAR_DEFAULT

let collapsed = ((): boolean => {
  try {
    return localStorage.getItem(KEY) === 'collapsed'
  } catch {
    return false
  }
})()
let width = ((): number => {
  try {
    return clampSidebarWidth(parseFloat(localStorage.getItem(WIDTH_KEY) ?? ''))
  } catch {
    return SIDEBAR_DEFAULT
  }
})()
const subs = new Set<() => void>()
const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export function toggleSidebar(): void {
  collapsed = !collapsed
  try {
    localStorage.setItem(KEY, collapsed ? 'collapsed' : 'expanded')
  } catch {
    // per-device preference only; ignore
  }
  subs.forEach((f) => f())
}

/** Live on every move of a drag with `persist` off; stored once it lands. */
export function setSidebarWidth(px: number, persist = true): void {
  width = clampSidebarWidth(px)
  if (persist) {
    try {
      localStorage.setItem(WIDTH_KEY, String(width))
    } catch {
      // per-device preference only; ignore
    }
  }
  subs.forEach((f) => f())
}

export const resetSidebarWidth = (): void => setSidebarWidth(SIDEBAR_DEFAULT)

export const useSidebarCollapsed = (): boolean => useSyncExternalStore(subscribe, () => collapsed)
export const useSidebarWidth = (): number => useSyncExternalStore(subscribe, () => width)
