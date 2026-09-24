/**
 * Invites overlay (key `i`): unanswered invitations of the next 60 days (visible calendars only).
 * Each reply goes through the invite's own account (api.events.respond with the event itself).
 * Keys: j/k ↓/↑ move, y accept, n decline, m maybe, esc/q close. Mouse: click a row to select it, wheel moves,
 * the buttons reply to the selected invite.
 */
import { useMemo, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { addDays, startOfDay } from 'date-fns'
import { formatWhen, ownerLine, pendingInvites } from '@mysticals/core/logic/details'
import { errorText } from '@mysticals/core/logic/editor'
import type { CalEvent, PartStat } from '@mysticals/core/shared/types'
import { eventKey, useApi, useDirectory, useEvents } from '../hooks'
import { Button, Clickable, useKeys } from '../mouse'
import { ansiOf, C } from '../theme'

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

  const move = (dir: 1 | -1): void => setIdx(Math.max(Math.min(sel + dir, invites.length - 1), 0))
  const replySelected = (status: Reply): void => void (invites[sel] && reply(invites[sel], status))

  useKeys((input, key) => {
    if (key.escape || input === 'q') return onClose()
    if (input === 'j' || key.downArrow) return move(1)
    if (input === 'k' || key.upArrow) return move(-1)
    if (Object.hasOwn(REPLY, input)) replySelected(REPLY[input])
  })

  return (
    <Clickable flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={1} onWheel={move}>
      <Text bold>Invitations</Text>
      {!loaded ? (
        <Text color={C.muted}>Loading…</Text>
      ) : invites.length === 0 ? (
        <Text color={C.muted}>No pending invites</Text>
      ) : (
        invites.map((e, i) => {
          const a = accounts.find((x) => x.id === e.accountId)
          const o = ownerLine(undefined, a?.label ?? e.accountId, a?.email)
          return (
            <Clickable key={eventKey(e)} height={1} onClick={() => setIdx(i)}>
              <Text wrap="truncate" inverse={i === sel}>
                {i === sel ? '▸ ' : '  '}
                <Text bold>{e.title || 'Untitled'}</Text> <Text color={C.muted}>{formatWhen(e)}</Text>{' '}
                <Text color={ansiOf(a?.color ?? '')}>●</Text> {o.label}
                {o.email ? ` · ${o.email}` : ''}
                {rows[eventKey(e)] ? <Text color={C.yellow}> {rows[eventKey(e)]}</Text> : null}
              </Text>
            </Clickable>
          )
        })
      )}
      {error ? <Text color={C.red}>{error}</Text> : null}
      <Box marginTop={1} flexWrap="wrap">
        {invites.length > 0 && <Button k="y" label="accept" color={C.green} onPress={() => replySelected('accepted')} />}
        {invites.length > 0 && <Button k="n" label="decline" color={C.red} onPress={() => replySelected('declined')} />}
        {invites.length > 0 && <Button k="m" label="maybe" color={C.yellow} onPress={() => replySelected('tentative')} />}
        <Box marginRight={2}>
          <Text color={C.muted}>j/k move</Text>
        </Box>
        <Button k="esc" label="close" onPress={onClose} />
      </Box>
    </Clickable>
  )
}
