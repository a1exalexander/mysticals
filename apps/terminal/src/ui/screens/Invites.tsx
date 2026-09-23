/**
 * Invites overlay (key `i`): unanswered invitations of the next 60 days (visible calendars only).
 * Each reply goes through the invite's own account (api.events.respond with the event itself).
 * Keys: j/k ↓/↑ move, y accept, n decline, m maybe, esc/q close.
 */
import { useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { addDays, startOfDay } from 'date-fns'
import { formatWhen, ownerLine, pendingInvites } from '@multicals/core/logic/details'
import { errorText } from '@multicals/core/logic/editor'
import type { CalEvent, PartStat } from '@multicals/core/shared/types'
import { eventKey, useApi, useDirectory, useEvents } from '../hooks'

export const INVITE_DAYS = 60

/** Visible events from today to INVITE_DAYS ahead (independent of the viewed range); the window moves daily. */
export function useUpcoming(now: Date): { events: CalEvent[]; loaded: boolean } {
  const day = startOfDay(now).getTime()
  const range = useMemo(() => ({ start: new Date(day).toISOString(), end: addDays(day, INVITE_DAYS).toISOString() }), [day])
  return useEvents(range)
}

type Reply = Exclude<PartStat, 'needsAction'>
const REPLY: Record<string, Reply> = { y: 'accepted', n: 'declined', m: 'tentative' }

export interface InvitesProps {
  onClose(): void
}

export function Invites({ onClose }: InvitesProps) {
  const api = useApi()
  const [now] = useState(() => new Date())
  const { events, loaded } = useUpcoming(now)
  const invites = useMemo(() => pendingInvites(events, now), [events, now])
  const { accounts } = useDirectory()
  const [idx, setIdx] = useState(0)
  // Row state per invite. A replied row stays locked ("sent") until the background sync reloads the list without it.
  const [rows, setRows] = useState<Record<string, 'sending…' | 'sent'>>({})
  const busy = useRef(new Set<string>()) // sync guard against key repeats landing before a re-render
  const [error, setError] = useState('')
  const sel = Math.min(idx, Math.max(invites.length - 1, 0))

  const reply = (e: CalEvent, status: Reply): void => {
    const k = eventKey(e)
    if (busy.current.has(k)) return
    busy.current.add(k)
    setError('')
    setRows((r) => ({ ...r, [k]: 'sending…' }))
    api.events.respond(e, status).then(
      () => setRows((r) => ({ ...r, [k]: 'sent' })),
      (err: unknown) => {
        busy.current.delete(k)
        setRows(({ [k]: _, ...r }) => r)
        setError(errorText(err))
      }
    )
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') return onClose()
    if (input === 'j' || key.downArrow) return setIdx(Math.min(sel + 1, Math.max(invites.length - 1, 0)))
    if (input === 'k' || key.upArrow) return setIdx(Math.max(sel - 1, 0))
    if (Object.hasOwn(REPLY, input) && invites[sel]) reply(invites[sel], REPLY[input])
  })

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Invitations</Text>
      {!loaded ? (
        <Text dimColor>Loading…</Text>
      ) : invites.length === 0 ? (
        <Text dimColor>No pending invites</Text>
      ) : (
        invites.map((e, i) => {
          const a = accounts.find((x) => x.id === e.accountId)
          const o = ownerLine(undefined, a?.label ?? e.accountId, a?.email)
          return (
            <Text key={eventKey(e)} wrap="truncate" inverse={i === sel}>
              {i === sel ? '▸ ' : '  '}
              <Text bold>{e.title || 'Untitled'}</Text> <Text dimColor>{formatWhen(e)}</Text>{' '}
              <Text color={a?.color}>●</Text> {o.label}
              {o.email ? ` · ${o.email}` : ''}
              {rows[eventKey(e)] ? <Text color="yellow"> {rows[eventKey(e)]}</Text> : null}
            </Text>
          )
        })
      )}
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>y accept · n decline · m maybe · j/k move · esc close</Text>
    </Box>
  )
}
