import { useSyncExternalStore } from 'react'
import type { CalEvent, DeleteScope } from '@shared/types'
import { eventKey } from '@mysticals/core/logic/layout'

/**
 * The events picked with ⌘-click (Ctrl-click off macOS) for one right-click action, and the events with an action in
 * flight (each pill shows a spinner). App-wide, like the nav state.
 */
let selected = new Map<string, CalEvent>()
let busy = new Set<string>()
let version = 0
const subs = new Set<() => void>()
const changed = (): void => {
  version++
  subs.forEach((f) => f())
}

export const selection = {
  events: (): CalEvent[] => [...selected.values()],
  size: (): number => selected.size,
  has: (e: CalEvent): boolean => selected.has(eventKey(e)),
  toggle(e: CalEvent): void {
    const k = eventKey(e)
    selected = new Map(selected)
    if (!selected.delete(k)) selected.set(k, e)
    changed()
  },
  clear(): void {
    if (!selected.size) return
    selected = new Map()
    changed()
  },
  isBusy: (e: CalEvent): boolean => busy.has(eventKey(e)),
  /** Marks `e` busy until `p` settles. */
  track<T>(e: CalEvent, p: Promise<T>): Promise<T> {
    const k = eventKey(e)
    busy = new Set(busy).add(k)
    changed()
    return p.finally(() => {
      busy = new Set(busy)
      busy.delete(k)
      changed()
    })
  }
}

/** The click picks (or unpicks) an event instead of opening it: ⌘ on macOS, Ctrl elsewhere. */
export const isPick = (e: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  document.documentElement.dataset.platform === 'darwin' ? e.metaKey : e.ctrlKey

/**
 * What a multi-selection action runs on: every picked event for "this event"; for a series-wide scope, one per series
 * (its earliest picked occurrence, where "this and following" starts), so a series isn't changed twice.
 */
export function bulkTargets(events: CalEvent[], scope: DeleteScope): CalEvent[] {
  if (scope === 'one') return events
  const seen = new Set<string>()
  return [...events]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .filter((e) => {
      if (!e.recurringEventId) return true
      const k = `${e.accountId}/${e.calendarId}/${e.recurringEventId}`
      return !seen.has(k) && !!seen.add(k)
    })
}

if (typeof window !== 'undefined') {
  // Esc, or a press anywhere but an event, its menu or a prompt, drops the selection. (An open menu or prompt takes
  // its Esc first, in the capture phase.)
  window.addEventListener('keydown', (e) => e.key === 'Escape' && selection.clear())
  window.addEventListener(
    'mousedown',
    (e) => !(e.target as Element | null)?.closest?.('[data-event-key], .ev-menu, dialog') && selection.clear(),
    true
  )
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

/** Re-renders on selection or busy changes; the pills read them through `eventMenu`. */
export const useMarks = (): number => useSyncExternalStore(subscribe, () => version)
