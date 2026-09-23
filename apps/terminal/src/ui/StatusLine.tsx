/**
 * Bottom status line (one row): current/next event (core `pickNowNext`, `startsLabel`), a transient
 * `message` from the shell (sync result, errors), and a short key hint ("? help").
 *
 * Props: { nav: Nav; events: CalEvent[]; now: Date; message?: string; width: number }
 * Keys: none (display only).
 */
import { Text } from 'ink'
import type { CalEvent } from '@multicals/core/shared/types'
import type { Nav } from './hooks'

export interface StatusLineProps {
  nav: Nav
  events: CalEvent[]
  now: Date
  message?: string
  width: number
}

export function StatusLine({ message }: StatusLineProps) {
  return <Text dimColor>{message ?? '? help · q quit'}</Text>
}
