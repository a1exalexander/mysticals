/**
 * Accounts & calendars overlay (key `s`): list accounts with their calendars, toggle calendar visibility,
 * add Google / CalDAV account, rename/recolor, remove, show per-account sync errors.
 *
 * Props: { onClose(): void }
 * Keys: while open this overlay owns ALL input (the shell's keymap is paused). Suggested: j/k move,
 * space toggle calendar, a add account, r rename, x remove (confirm), esc/q close.
 * Data: useApi(), useDirectory().
 */
import { Text } from 'ink'

export interface AccountsProps {
  onClose(): void
}

export function Accounts(_props: AccountsProps) {
  return <Text>Accounts</Text>
}
