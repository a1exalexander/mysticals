/**
 * Event details overlay: title, when (core `formatWhen`), owner (`ownerLine`), location/meeting link
 * (`meetingUrl`), attendees with `STATUS_ICON`, notes (`cleanNotes`); RSVP and delete actions.
 *
 * Props: { event: CalEvent; onClose(): void; onEdit(event: CalEvent): void }
 * Keys: while open this overlay owns ALL input (the shell's keymap is paused). Suggested: esc/q close,
 * e edit (only if core `canEdit`), y/n/m accept/decline/maybe via api.events.respond (owning account only),
 * x delete (ask scope 'one'|'following'|'all' for recurring), o open meeting URL.
 * Data: useApi() for actions, useDirectory() for account/calendar labels.
 */
import { Text } from 'ink'
import type { CalEvent } from '@multicals/core/shared/types'

export interface EventDetailsProps {
  event: CalEvent
  onClose(): void
  onEdit(event: CalEvent): void
}

export function EventDetails({ event }: EventDetailsProps) {
  return <Text>Event details: {event.title}</Text>
}
