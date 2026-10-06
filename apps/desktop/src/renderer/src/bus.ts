import type { CalEvent, DeleteScope } from '@shared/types'
import type { PasteSlot } from '@mysticals/core/logic/copy'

/** Tiny UI event bus that decouples views (unit 6), editor/details (unit 7), accounts (unit 8). */
export interface BusEvents {
  /** Open the create-event editor, optionally prefilled with a range. */
  'event:create': { start?: string; end?: string; allDay?: boolean }
  /** Open details for an existing event (anchor = clicked element rect for popover; el = that element, followed on resize). */
  'event:open': { event: CalEvent; anchor?: DOMRect; el?: HTMLElement }
  /** Open the edit form for an existing event. */
  'event:edit': { event: CalEvent }
  /** Right-click menu at the pointer: an event's actions, or a free time / day (paste, new event). */
  'menu:event': { event: CalEvent; x: number; y: number }
  'menu:slot': { slot: PasteSlot; end: string; x: number; y: number }
  'accounts:open': Record<string, never>
  'settings:open': Record<string, never>
  /** Ask for new credentials of an account the server stopped accepting (`authError`). */
  'reauth:open': { accountId: string }
  /** Toggle the invitations panel in the status bar. */
  'invites:open': Record<string, never>
  /** Short notice above the status bar (e.g. "Event moved · Undo"); replaces the one shown. */
  toast: { text: string; error?: boolean; action?: { label: string; run: () => void } }
  /** Ask which part of a recurring series a change is for; exactly one of the callbacks runs. */
  'scope:ask': { title: string; onPick: (scope: DeleteScope) => void; onCancel: () => void }
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
