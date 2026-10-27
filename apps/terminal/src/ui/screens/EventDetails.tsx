/**
 * Event details overlay: title, when, owner, location/meeting link, attendees (first 5, "a" or click for all), notes; RSVP, colour, edit, delete (keys or clicks).
 * Also exports EventInfo (the read-only body), reused by the shell's preview pane.
 * Owns ALL input while open. RSVPs and deletes always go through the event's own account (the event object itself).
 * Taller than `height` rows: the body scrolls (↑/↓, PgUp/PgDn, wheel) and the action buttons stay at the bottom.
 */
import { useState } from 'react'
import { Box, Text } from 'ink'
import { canEdit, cleanNotes, formatWhen, htmlToText, isHtml, ownerLine, STATUS_ICON } from '@mysticals/core/logic/details'
import { errorText } from '@mysticals/core/logic/editor'
import { eventLinks, eventMeetingUrl, linkLabel, locationText, type LinkKind } from '@mysticals/core/logic/meeting'
import { eventBounds } from '@mysticals/core/logic/layout'
import { startsLabel } from '@mysticals/core/logic/status'
import { EVENT_COLORS, eventColorOf } from '@mysticals/core/logic/colors'
import type { Account, Calendar, CalEvent, ColorScope, DeleteScope, PartStat } from '@mysticals/core/shared/types'
import { openUrl as openInBrowser } from '../../daemon/google'
import { useApi, useDirectory, useNow } from '../hooks'
import { Button, Clickable, useKeys } from '../mouse'
import { Scroll, useHeight, useScrollArea } from '../scroll'
import { ansiOf, C } from '../theme'

export interface EventDetailsProps {
  event: CalEvent
  /** `done`: what an action that closed the overlay did ("Event deleted"), for the status line. */
  onClose(done?: string): void
  onEdit(event: CalEvent): void
  /** Rows the overlay may take, border included. */
  height?: number
}

type Reply = Exclude<PartStat, 'needsAction'>
const REPLY_KEYS: Record<string, Reply> = { y: 'accepted', n: 'declined', m: 'tentative' }
const SCOPE_KEYS: Record<string, DeleteScope> = { '1': 'one', '2': 'following', '3': 'all' }
const COLOR_SCOPE_KEYS: Record<string, ColorScope> = { '1': 'one', '3': 'all' }
/** The colour choices: the calendar's own (null), then the 11 event colours. */
const COLORS: { id: string | null; name: string; hex?: string }[] = [
  { id: null, name: 'calendar colour' },
  ...EVENT_COLORS.map((c) => ({ id: c.id, name: c.key, hex: c.hex }))
]
const STATUS_LABEL: Record<PartStat, string> = { accepted: 'accepted', declined: 'declined', tentative: 'maybe', needsAction: 'not answered' }
const STATUS_COLOR: Record<PartStat, string> = { accepted: C.green, declined: C.red, tentative: C.yellow, needsAction: C.muted }

// Argument vector, no shell (see openCommand): the URL comes from event data and must never be interpreted.
const openUrl = (url: string): void => void openInBrowser(url).catch(() => {})

export function EventDetails({ event: initial, onClose, onEdit, height = Infinity }: EventDetailsProps) {
  const api = useApi()
  const { accounts, calendars } = useDirectory()
  const [event, setEvent] = useState(initial)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [showAll, setShowAll] = useState(false)
  /** Picking a colour: the highlighted choice (index into COLORS); then, for a series, which part it is for. */
  const [picking, setPicking] = useState<number>()
  const [colorAsk, setColorAsk] = useState<string | null>()
  const manyAttendees = initial.attendees.length > ATTENDEES_SHOWN

  const account = accounts.find((a) => a.id === event.accountId)
  const calendar = calendars.find((c) => c.accountId === event.accountId && c.id === event.calendarId)
  const editable = canEdit(event, account, calendar)
  // Not canEdit: an invitee may recolour its own copy too.
  const colorable = !!account && !!calendar && !calendar.readOnly
  const recurring = !!event.recurringEventId
  const url = eventMeetingUrl(event)
  const now = useNow()
  const [foot, footHeight] = useHeight()
  const scroll = useScrollArea(height - 2 - footHeight) // 2: border

  /** Shows `label` while `fn` runs; a failure shows as "`failed`: reason". */
  const run = (label: string, failed: string, fn: () => Promise<void>): void => {
    setBusy(label)
    setError('')
    fn().then(
      () => setBusy(undefined),
      (e: unknown) => {
        setBusy(undefined)
        setError(`${failed}: ${errorText(e)}`)
      }
    )
  }
  const respond = (status: Reply): void =>
    run('Replying…', 'Reply not sent', async () => setEvent(await api.events.respond(event, status)))
  const recolor = (colorId: string | null, scope: ColorScope): void => {
    setPicking(undefined)
    setColorAsk(undefined)
    if ((event.colorId ?? null) !== colorId) run('Recolouring…', 'Colour not changed', async () => setEvent(await api.events.setColor(event, colorId, scope)))
  }
  const choose = (i: number): void => {
    const id = COLORS[i].id
    if (recurring && (event.colorId ?? null) !== id) {
      setPicking(undefined)
      setColorAsk(id)
    } else recolor(id, 'one')
  }
  const startPicking = (): void => setPicking(Math.max(0, COLORS.findIndex((c) => c.id === (event.colorId ?? null))))
  const remove = (scope: DeleteScope): void =>
    run('Deleting…', 'Not deleted', async () => {
      await api.events.delete(event, scope)
      onClose(scope === 'one' ? 'Event deleted' : 'Events deleted')
    })

  useKeys((input, key) => {
    if (key.escape && confirm) return setConfirm(false)
    if (key.escape && (picking !== undefined || colorAsk !== undefined)) return (setPicking(undefined), setColorAsk(undefined))
    if (key.escape || input === 'q') return onClose()
    if (key.upArrow || key.downArrow) return scroll.scrollBy(key.upArrow ? -1 : 1)
    if (key.pageUp || key.pageDown) return scroll.scrollBy((key.pageUp ? -1 : 1) * Math.max(scroll.view.rows - 1, 1))
    if (busy) return
    if (colorAsk !== undefined) {
      if (Object.hasOwn(COLOR_SCOPE_KEYS, input)) recolor(colorAsk, COLOR_SCOPE_KEYS[input])
      return
    }
    if (picking !== undefined) {
      const step = key.leftArrow || input === 'h' ? -1 : key.rightArrow || input === 'l' ? 1 : 0
      if (step) setPicking((picking + step + COLORS.length) % COLORS.length)
      else if (key.return) choose(picking)
      return
    }
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
    if (input === 'c' && colorable) return startPicking()
    if (input === 'a' && manyAttendees) return setShowAll(!showAll)
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={1}>
      <Scroll {...scroll.view}>
        <EventInfo event={event} account={account} calendar={calendar} now={now} showAll={showAll} onToggleAll={() => setShowAll(!showAll)} />
      </Scroll>
      <Box ref={foot} flexDirection="column" flexShrink={0}>
        {error && <Text color={C.red}>{error}</Text>}
        <Box marginTop={1} flexWrap="wrap">
          {busy ? (
            <Text color={C.yellow}>{busy}</Text>
          ) : colorAsk !== undefined ? (
            <>
              <Text>Recolour recurring event: </Text>
              <Button k="1" label="this event" onPress={() => recolor(colorAsk, 'one')} />
              <Button k="3" label="all events" onPress={() => recolor(colorAsk, 'all')} />
              <Button k="esc" label="cancel" onPress={() => setColorAsk(undefined)} />
            </>
          ) : picking !== undefined ? (
            <>
              <Box marginRight={1} flexShrink={0}>
                {COLORS.map((c, i) => (
                  <Clickable key={c.name} onClick={() => choose(i)}>
                    <Text inverse={i === picking} color={c.hex ?? eventColorOf({}, calendar, account)}>{c.id ? ' ● ' : ' ○ '}</Text>
                  </Clickable>
                ))}
              </Box>
              <Text bold>{COLORS[picking].name} </Text>
              <Text color={C.muted}>←→ choose </Text>
              <Button k="enter" label="apply" onPress={() => choose(picking)} />
              <Button k="esc" label="cancel" onPress={() => setPicking(undefined)} />
            </>
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
              {colorable && <Button k="c" label="colour" onPress={startPicking} />}
              {manyAttendees && <Button k="a" label={showAll ? 'fewer attendees' : 'all attendees'} onPress={() => setShowAll(!showAll)} />}
              <Button k="esc" label="close" onPress={onClose} />
              {scroll.more && <Text color={C.muted}>↑↓ scroll</Text>}
            </>
          )}
        </Box>
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
/** Prefix per link kind: calls get a camera, maps a pin. */
const LINK_GLYPH: Record<LinkKind, string> = { meet: '▶', zoom: '▶', teams: '▶', video: '▶', map: '⌖', link: '↗' }
/** Kinds whose service name is worth printing next to the URL. */
const NAMED = new Set<LinkKind>(['meet', 'zoom', 'teams'])

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
  const links = eventLinks(event)
  const where = locationText(event.location)
  const raw = cleanNotes(event.description)
  const notes = isHtml(raw) ? htmlToText(raw) : raw
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
        <Text color={ansiOf(eventColorOf(event, calendar, account))}>●</Text> {owner.calendar && `${owner.calendar} in `}
        <Text bold>{owner.label}</Text>
        {owner.email && ` · ${owner.email}`}
        {calendar?.readOnly && ' · read-only'}
      </Text>
      {where && <Text>Location: {where}</Text>}
      {links.map((l) => (
        <Clickable key={l.url} onClick={() => openUrl(l.url)}>
          <Text wrap="truncate">
            <Text color={l.kind === 'map' || l.kind === 'link' ? C.muted : C.green}>
              {LINK_GLYPH[l.kind]} {NAMED.has(l.kind) ? `${linkLabel(l.url, l.kind)} ` : ''}
            </Text>
            <Text color={C.cyan} underline>{l.url}</Text>
          </Text>
        </Clickable>
      ))}
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
