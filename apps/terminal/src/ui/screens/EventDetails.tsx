/**
 * Event details overlay: title, when, owner, location/meeting link, attendees, notes; RSVP, edit, delete.
 * Owns ALL input while open. RSVPs and deletes always go through the event's own account (the event object itself).
 */
import { useState } from 'react'
import { execFile } from 'node:child_process'
import { Box, Text, useInput } from 'ink'
import { canEdit, cleanNotes, formatWhen, ownerLine, STATUS_ICON } from '@multicals/core/logic/details'
import { errorText } from '@multicals/core/logic/editor'
import { meetingUrl } from '@multicals/core/logic/meeting'
import type { CalEvent, DeleteScope, PartStat } from '@multicals/core/shared/types'
import { useApi, useDirectory } from '../hooks'

export interface EventDetailsProps {
  event: CalEvent
  onClose(): void
  onEdit(event: CalEvent): void
}

type Reply = Exclude<PartStat, 'needsAction'>
const REPLY_KEYS: Record<string, Reply> = { y: 'accepted', n: 'declined', m: 'tentative' }
const SCOPE_KEYS: Record<string, DeleteScope> = { '1': 'one', '2': 'following', '3': 'all' }
const STATUS_LABEL: Record<PartStat, string> = { accepted: 'accepted', declined: 'declined', tentative: 'maybe', needsAction: 'not answered' }

// Argument vector, no shell: the URL comes from event data and must never be interpreted.
const openUrl = (url: string): void => void execFile('open', [url], () => {})

export function EventDetails({ event: initial, onClose, onEdit }: EventDetailsProps) {
  const api = useApi()
  const { accounts, calendars } = useDirectory()
  const [event, setEvent] = useState(initial)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)

  const account = accounts.find((a) => a.id === event.accountId)
  const calendar = calendars.find((c) => c.accountId === event.accountId && c.id === event.calendarId)
  const editable = canEdit(event, account, calendar)
  const recurring = !!event.recurringEventId
  const url = meetingUrl(event.location)
  const notes = cleanNotes(event.description)
  const owner = ownerLine(calendar?.name ?? 'Calendar', account?.label ?? event.accountId, account?.email)

  const run = (label: string, fn: () => Promise<void>): void => {
    setBusy(label)
    setError('')
    fn().then(
      () => setBusy(undefined),
      (e: unknown) => {
        setBusy(undefined)
        setError(errorText(e))
      }
    )
  }
  const respond = (status: Reply): void =>
    run('Replying…', async () => setEvent(await api.events.respond(event, status)))
  const remove = (scope: DeleteScope): void =>
    run('Deleting…', async () => {
      await api.events.delete(event, scope)
      onClose()
    })

  useInput((input, key) => {
    if (key.escape && confirm) return setConfirm(false)
    if (key.escape || input === 'q') return onClose()
    if (busy) return
    if (confirm) {
      if (recurring && Object.hasOwn(SCOPE_KEYS, input)) return remove(SCOPE_KEYS[input])
      if (!recurring && (input === 'y' || key.return)) return remove('one')
      if (input === 'n') setConfirm(false)
      return
    }
    if (event.myStatus && Object.hasOwn(REPLY_KEYS, input)) return respond(REPLY_KEYS[input])
    if (input === 'o' && url) return openUrl(url)
    if (input === 'e' && editable) return onEdit(event)
    if (input === 'x' && editable) return setConfirm(true)
  })

  const hints = [
    event.myStatus && 'y accept  n decline  m maybe',
    url && 'o open link',
    editable && 'e edit  x delete',
    'esc close'
  ].filter(Boolean)

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{event.title || 'Untitled'}</Text>
      <Text>{formatWhen(event)}</Text>
      <Text dimColor>
        {owner.calendar && `${owner.calendar} in `}
        <Text bold>{owner.label}</Text>
        {owner.email && ` · ${owner.email}`}
      </Text>
      {event.location && <Text>Location: {event.location}</Text>}
      {url && url !== event.location && <Text color="cyan">{url}</Text>}
      {event.organizer && (
        <Text>Organizer: {event.organizer.name ? `${event.organizer.name} <${event.organizer.email}>` : event.organizer.email}</Text>
      )}
      {event.attendees.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Attendees ({event.attendees.length})</Text>
          {event.attendees.map((a) => (
            <Text key={a.email}>
              {STATUS_ICON[a.status]} {a.name ?? a.email}
              {a.self ? ' (you)' : ''}
              {a.organizer ? ' (organizer)' : ''}
            </Text>
          ))}
        </Box>
      )}
      {notes && (
        <Box marginTop={1}>
          <Text>{notes}</Text>
        </Box>
      )}
      {event.myStatus && (
        <Box marginTop={1}>
          <Text>
            Your reply: <Text bold>{STATUS_ICON[event.myStatus]} {STATUS_LABEL[event.myStatus]}</Text>
            <Text dimColor> as {account?.email ?? event.accountId}</Text>
          </Text>
        </Box>
      )}
      {error && <Text color="red">{error}</Text>}
      <Box marginTop={1}>
        {busy ? (
          <Text color="yellow">{busy}</Text>
        ) : confirm && recurring ? (
          <Text color="red">Delete recurring event: 1 this event  2 this and following  3 all events  esc cancel</Text>
        ) : confirm ? (
          <Text color="red">Delete this event? y yes  n no</Text>
        ) : (
          <Text dimColor>{hints.join('  ·  ')}</Text>
        )}
      </Box>
    </Box>
  )
}
