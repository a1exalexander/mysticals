import type { CalEvent } from '@shared/types'

/** Tiny UI event bus that decouples views (unit 6), editor/details (unit 7), accounts (unit 8). */
export interface BusEvents {
  /** Open the create-event editor, optionally prefilled with a range. */
  'event:create': { start?: string; end?: string; allDay?: boolean }
  /** Open details for an existing event (anchor = clicked element rect for popover). */
  'event:open': { event: CalEvent; anchor?: DOMRect }
  /** Open the edit form for an existing event. */
  'event:edit': { event: CalEvent }
  'accounts:open': Record<string, never>
  'settings:open': Record<string, never>
  /** Toggle the invitations panel in the status bar. */
  'invites:open': Record<string, never>
  /** Optimistic calendar show/hide, applied locally before the IPC write settles. */
  'calendars:visible': { accountId: string; calendarId: string; visible: boolean }
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void
const handlers = new Map<keyof BusEvents, Set<Handler<never>>>()

export const bus = {
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void {
    handlers.get(type)?.forEach((h) => (h as Handler<K>)(payload))
  },
  on<K extends keyof BusEvents>(type: K, h: Handler<K>): () => void {
    if (!handlers.has(type)) handlers.set(type, new Set())
    handlers.get(type)!.add(h as Handler<never>)
    return () => handlers.get(type)!.delete(h as Handler<never>)
  }
}
