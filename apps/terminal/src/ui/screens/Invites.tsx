/**
 * Invites overlay (key `i`): pending invitations (core `pendingInvites` over visible events) with
 * RSVP via the owning account only (api.events.respond).
 *
 * Props: { onClose(): void }
 * Keys: while open this overlay owns ALL input (the shell's keymap is paused). Suggested: j/k move,
 * y/n/m accept/decline/maybe, esc/q close.
 * Data: useApi(), useEvents(range) for the range to scan, useDirectory() for labels.
 */
import { Text } from 'ink'

export interface InvitesProps {
  onClose(): void
}

export function Invites(_props: InvitesProps) {
  return <Text>Invites</Text>
}
