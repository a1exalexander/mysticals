/**
 * Event editor overlay (create when `event` is absent, edit otherwise). Form logic lives in core
 * `logic/editor` (emptyForm, formFromEvent, applyForm, formToInput, writableAccounts, writableCalendars, errorText).
 * Per-account isolation: no default account/calendar — the user must pick both when creating.
 *
 * Props: { event?: CalEvent; initialStart?: Date; onClose(): void }
 * Keys: while open this overlay owns ALL input (the shell's keymap is paused). Suggested: tab/shift-tab
 * or ↓/↑ move between fields, enter on last field or ctrl+s save, esc cancel.
 * Data: useApi() for create/update, useDirectory() for accounts/calendars.
 */
import { Text } from 'ink'
import type { CalEvent } from '@multicals/core/shared/types'

export interface EventEditorProps {
  event?: CalEvent
  initialStart?: Date
  onClose(): void
}

export function EventEditor({ event }: EventEditorProps) {
  return <Text>{event ? 'Edit event' : 'New event'}</Text>
}
