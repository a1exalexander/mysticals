/**
 * Event details overlay: title, when, owner, location/meeting link, attendees (first 5, "a" or click for all), notes; RSVP, edit, delete (keys or clicks).
 * Also exports EventInfo (the read-only body), reused by the shell's preview pane.
 * Owns ALL input while open. RSVPs and deletes always go through the event's own account (the event object itself).
 */
import { useState } from 'react'
import { execFile } from 'node:child_process'
import { Box, Text } from 'ink'
import { canEdit, cleanNotes, formatWhen, ownerLine, STATUS_ICON } from '@multicals/core/logic/details'
import { errorText } from '@multicals/core/logic/editor'
import { meetingUrl } from '@multicals/core/logic/meeting'
import { eventBounds } from '@multicals/core/logic/layout'
import { startsLabel } from '@multicals/core/logic/status'
import type { Account, Calendar, CalEvent, DeleteScope, PartStat } from '@multicals/core/shared/types'
import { useApi, useDirectory, useNow } from '../hooks'
import { Button, Clickable, useKeys } from '../mouse'
import { ansiOf, C } from '../theme'

export interface EventDetailsProps {
  event: CalEvent
  onClose(): void
  onEdit(event: CalEvent): void
}

type Reply = Exclude<PartStat, 'needsAction'>
const REPLY_KEYS: Record<string, Reply> = { y: 'accepted', n: 'declined', m: 'tentative' }
const SCOPE_KEYS: Record<string, DeleteScope> = { '1': 'one', '2': 'following', '3': 'all' }
const STATUS_LABEL: Record<PartStat, string> = { accepted: 'accepted', declined: 'declined', tentative: 'maybe', needsAction: 'not answered' }
const STATUS_COLOR: Record<PartStat, string> = { accepted: C.green, declined: C.red, tentative: C.yellow, needsAction: C.muted }

// Argument vector, no shell: the URL comes from event data and must never be interpreted.
const openUrl = (url: string): void => void execFile('open', [url], () => {})

export function EventDetails({ event: initial, onClose, onEdit }: EventDetailsProps) {
  const api = useApi()
  const { accounts, calendars } = useDirectory()
  const [event, setEvent] = useState(initial)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const manyAttendees = initial.attendees.length > ATTENDEES_SHOWN

  const account = accounts.find((a) => a.id === event.accountId)
  const calendar = calendars.find((c) => c.accountId === event.accountId && c.id === event.calendarId)
  const editable = canEdit(event, account, calendar)
  const recurring = !!event.recurringEventId
  const url = meetingUrl(event.location)
  const now = useNow()

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

  useKeys((input, key) => {
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
    if (input === 'a' && manyAttendees) return setShowAll(!showAll)
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={1}>
      <EventInfo event={event} account={account} calendar={calendar} now={now} showAll={showAll} onToggleAll={() => setShowAll(!showAll)} />
      {error && <Text color={C.red}>{error}</Text>}
      <Box marginTop={1} flexWrap="wrap">
        {busy ? (
          <Text color={C.yellow}>{busy}</Text>
        ) : confirm && recurring ? (
          <>
            <Text color={C.red}>Delete recurring event: </Text>
            <Button k="1" label="this event" color={C.red} onPress={() => remove('one')} />
            <Button k="2" label="this and following" color={C.red} onPress={() => remove('following')} />
            <Button k="3" label="all events" color={C.red} onPress={() => remove('all')} />
            <Button k="esc" label="cancel" onPress={() => setConfirm(false)} />
          </>
        ) : confirm ? (
          <>
            <Text color={C.red}>Delete this event? </Text>
            <Button k="y" label="yes" color={C.red} onPress={() => remove('one')} />
            <Button k="n" label="no" onPress={() => setConfirm(false)} />
          </>
        ) : (
          <>
            {event.myStatus && <Button k="y" label="accept" color={C.green} onPress={() => respond('accepted')} />}
            {event.myStatus && <Button k="n" label="decline" color={C.red} onPress={() => respond('declined')} />}
            {event.myStatus && <Button k="m" label="maybe" color={C.yellow} onPress={() => respond('tentative')} />}
            {url && <Button k="o" label="open link" onPress={() => openUrl(url)} />}
            {editable && <Button k="e" label="edit" onPress={() => onEdit(event)} />}
            {editable && <Button k="x" label="delete" onPress={() => setConfirm(true)} />}
            {manyAttendees && <Button k="a" label={showAll ? 'fewer attendees' : 'all attendees'} onPress={() => setShowAll(!showAll)} />}
            <Button k="esc" label="close" onPress={onClose} />
          </>
        )}
      </Box>
    </Box>
  )
}

/** "45m", "1h", "1h 30m"; empty for all-day events. */
export function duration(e: CalEvent): string {
  if (e.allDay) return ''
  const m = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60_000)
  const h = Math.floor(m / 60)
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`
}

/** "now", "in 25m" / "at 14:00" within a day, "ended"; empty otherwise and for all-day events. */
export function relative(e: CalEvent, now: Date): string {
  if (e.allDay) return ''
  const { start, end } = eventBounds(e)
  if (end <= now) return 'ended'
  if (start <= now) return 'now'
  return +start - +now < 24 * 3600_000 ? startsLabel(e.start, now) : ''
}

const tally = (attendees: CalEvent['attendees']): string =>
  (['accepted', 'tentative', 'declined', 'needsAction'] as PartStat[])
    .map((s) => [attendees.filter((a) => a.status === s).length, s] as const)
    .filter(([n]) => n)
    .map(([n, s]) => `${n} ${STATUS_LABEL[s]}`)
    .join(', ')

/** Read-only event body shared by the details overlay and the preview pane. */
/** Attendees listed before "show more". */
export const ATTENDEES_SHOWN = 5

export function EventInfo({ event, account, calendar, now, showAll, onToggleAll }: {
  event: CalEvent
  account?: Account
  calendar?: Calendar
  now: Date
  /** List every attendee instead of the first ATTENDEES_SHOWN; toggled by the "show more/less" row. */
  showAll?: boolean
  onToggleAll?(): void
}) {
  const url = meetingUrl(event.location)
  const notes = cleanNotes(event.description)
  const owner = ownerLine(calendar?.name ?? 'Calendar', account?.label ?? event.accountId, account?.email)
  const when = [duration(event), relative(event, now)].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column">
      <Text bold>{event.title || 'Untitled'}</Text>
      <Text>
        {formatWhen(event)}
        {when && <Text color={relative(event, now) === 'now' ? C.green : C.muted}> ({when})</Text>}
        {event.recurringEventId && <Text color={C.muted}> ↻ repeats</Text>}
      </Text>
      <Text color={C.muted}>
        <Text color={ansiOf(calendar?.color ?? account?.color ?? '')}>●</Text> {owner.calendar && `${owner.calendar} in `}
        <Text bold>{owner.label}</Text>
        {owner.email && ` · ${owner.email}`}
        {calendar?.readOnly && ' · read-only'}
      </Text>
      {event.location && <Text>Location: {event.location}</Text>}
      {url && url !== event.location && (
        <Clickable onClick={() => openUrl(url)}>
          <Text color={C.cyan} underline>{url}</Text>
        </Clickable>
      )}
      {event.organizer && (
        <Text>Organizer: {event.organizer.name ? `${event.organizer.name} <${event.organizer.email}>` : event.organizer.email}</Text>
      )}
      {event.attendees.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={C.muted}>
            Attendees ({event.attendees.length}): {tally(event.attendees)}
          </Text>
          {(showAll ? event.attendees : event.attendees.slice(0, ATTENDEES_SHOWN)).map((a) => (
            <Text key={a.email} wrap="truncate">
              <Text color={STATUS_COLOR[a.status]}>{STATUS_ICON[a.status]}</Text> {a.name ?? a.email}
              {a.name && <Text color={C.muted}> {a.email}</Text>}
              {a.self ? ' (you)' : ''}
              {a.organizer ? ' (organizer)' : ''}
            </Text>
          ))}
          {event.attendees.length > ATTENDEES_SHOWN && (
            <Clickable onClick={onToggleAll}>
              <Text color={C.accent}>
                {showAll ? '▴ show less' : `▾ show ${event.attendees.length - ATTENDEES_SHOWN} more`}
              </Text>
            </Clickable>
          )}
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
            Your reply: <Text bold color={STATUS_COLOR[event.myStatus]}>{STATUS_ICON[event.myStatus]} {STATUS_LABEL[event.myStatus]}</Text>
            <Text color={C.muted}> as {account?.email ?? event.accountId}</Text>
          </Text>
        </Box>
      )}
    </Box>
  )
}
