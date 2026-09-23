/**
 * Bottom status line (one row, truncated to `width`): current event(s) and the next one within 24h
 * (core `pickNowNext`, `startsLabel`), pending invite count, accounts whose last sync failed,
 * a transient `message` from the shell, and "? help".
 * Now/next and invites come from a today+60d fetch, so they don't depend on the viewed range.
 */
import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import { pickNowNext, startsLabel } from '@multicals/core/logic/status'
import { pendingInvites } from '@multicals/core/logic/details'
import type { CalEvent } from '@multicals/core/shared/types'
import { useDirectory, type Nav } from './hooks'
import { useUpcoming } from './screens/Invites'

export interface StatusLineProps {
  nav: Nav
  /** Unused: the status line loads its own upcoming window. Kept for the shell's contract. */
  events: CalEvent[]
  now: Date
  message?: string
  width: number
}

const DAY_MS = 24 * 3600_000

export function StatusLine({ now, message, width }: StatusLineProps) {
  const { events } = useUpcoming(now)
  const failed = useDirectory().accounts.filter((a) => a.error)
  const { current, next } = pickNowNext(events, now)
  const soon = next && Date.parse(next.start) - now.getTime() < DAY_MS ? next : undefined
  const invites = pendingInvites(events, now).length

  const parts: ReactNode[] = []
  if (current.length) parts.push(<><Text color="green">now</Text> {current.map((e) => e.title || 'Untitled').join(', ')}</>)
  if (soon) parts.push(<><Text color="cyan">next</Text> {soon.title || 'Untitled'} {startsLabel(soon.start, now)}</>)
  if (invites) parts.push(<Text color="yellow">{invites === 1 ? '1 invite' : `${invites} invites`} (i)</Text>)
  if (failed.length) parts.push(<Text color="red">⚠ {failed.map((a) => a.label).join(', ')} sync failed (s)</Text>)
  if (message) parts.push(message)
  parts.push(<Text dimColor>? help</Text>)

  return (
    <Box width={width}>
      <Text wrap="truncate">
        {parts.map((p, i) => (
          <Text key={i}>
            {i > 0 && <Text dimColor> · </Text>}
            {p}
          </Text>
        ))}
      </Text>
    </Box>
  )
}
