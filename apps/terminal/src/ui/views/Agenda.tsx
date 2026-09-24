/**
 * Agenda (default view): AGENDA_DAYS days from `date`, one block per day.
 *
 *    Thu 24 Sep  today ─────────────────────────────── 3 events · 2h busy     heading (click: day view)
 *    07:00 ▌ Morning run  ● now · ends in 25m                           45m   card, 2 lines:
 *    07:45 ▌ Personal  ↻ repeats  ⚠ overlaps  Room 3  4 people                  start/end, calendar-colored bar,
 *    09:12 ──────────────────────────────────────────────────                   title + badges, details
 *    Fri 25 Sep – Sat 26 Sep  free                                              runs of empty days
 *
 * Badges: running (green), next today ("in 25m"), RSVP / maybe / declined. Past cards are muted; the selected card
 * is inverse. Click a card to select it, again to open it.
 *
 * Props: ViewProps (ui/hooks.ts). Keys: the App shell owns them all; the view keeps the selected card scrolled into
 * view within `height` lines.
 *
 * Also exports the row helpers (useOwnerOf, useColorOf, useScroll, clickEvent, rsvpMark, place) the other views reuse.
 */
import { useMemo, useRef, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { addDays, differenceInCalendarDays, differenceInMinutes, format, isSameDay, startOfDay } from 'date-fns'
import { eventBounds, eventsOnDay, isPast, ymd } from '@mysticals/core/logic/layout'
import { STATUS_ICON } from '@mysticals/core/logic/details'
import { meetingUrl } from '@mysticals/core/logic/meeting'
import { startsLabel } from '@mysticals/core/logic/status'
import type { CalEvent } from '@mysticals/core/shared/types'
import { AGENDA_DAYS, eventKey, useDirectory, type ViewProps } from '../hooks'
import { Clickable } from '../mouse'
import { ansiOf, C } from '../theme'
import { duration } from '../screens/EventDetails'

/** Event color (its calendar's, else its account's, as ANSI: same fallback chain as the desktop app), account and calendar names. */
export function useOwnerOf(): { colorOf(e: CalEvent): string; accountOf(e: CalEvent): string; calendarOf(e: CalEvent): string } {
  const { accounts, calendars } = useDirectory()
  return useMemo(() => {
    const cal = new Map(calendars.map((c) => [`${c.accountId}/${c.id}`, c]))
    const acc = new Map(accounts.map((a) => [a.id, a]))
    return {
      colorOf: (e) => ansiOf(cal.get(`${e.accountId}/${e.calendarId}`)?.color ?? acc.get(e.accountId)?.color ?? ''),
      accountOf: (e) => acc.get(e.accountId)?.label ?? e.accountId,
      calendarOf: (e) => cal.get(`${e.accountId}/${e.calendarId}`)?.name ?? ''
    }
  }, [accounts, calendars])
}

export const useColorOf = (): ((e: CalEvent) => string) => useOwnerOf().colorOf

/** Click selects; a click on the already selected event opens it. */
export const clickEvent = (e: CalEvent, selected: boolean, { onSelect, onOpen }: Pick<ViewProps, 'onSelect' | 'onOpen'>) =>
  () => (selected ? onOpen(e) : onSelect(e))

/**
 * First visible row of a `total`-row list shown `height` rows at a time: moves only as far as needed to keep
 * rows `first..last` in view (so j/k don't jump the page; `first` wins if they don't fit), starting at `first`.
 */
export function useScroll(first: number, last: number, height: number, total: number): number {
  const off = useRef<number>(undefined)
  let o = off.current ?? first
  if (last >= o + height) o = last - height + 1
  if (first < o) o = first
  o = Math.max(0, Math.min(o, total - height))
  off.current = o
  return o
}

/** RSVP marker for invites not yet accepted; empty otherwise. */
export const rsvpMark = (e: CalEvent): string =>
  e.myStatus && e.myStatus !== 'accepted' ? `${STATUS_ICON[e.myStatus]} ` : ''

/** Location without its meeting link ("Room 3 / https://…" → "Room 3"); "video call" when it is only a link. */
export function place(location = ''): string {
  const url = meetingUrl(location)
  const rest = (url ? location.replace(url, '') : location).replace(/^[\s/|,·-]+|[\s/|,·-]+$/g, '')
  return rest || (url ? 'video call' : '')
}

/** Minutes as "45m", "1h", "1h 5m". */
const span = (m: number): string => {
  const h = Math.floor(m / 60)
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`
}

/** Minutes of `day` covered by its timed, non-declined events (overlaps counted once). */
function busyMinutes(list: CalEvent[], day: Date): number {
  const from = +startOfDay(day)
  const to = +addDays(day, 1)
  const iv = list
    .filter((e) => !e.allDay && e.myStatus !== 'declined')
    .map((e) => [Math.max(+eventBounds(e).start, from), Math.min(+eventBounds(e).end, to)])
    .sort((a, b) => a[0] - b[0])
  let total = 0
  let end = -Infinity
  for (const [s, t] of iv) {
    if (t <= end) continue
    total += t - Math.max(s, end)
    end = t
  }
  return Math.round(total / 60_000)
}

const overlaps = (e: CalEvent, list: CalEvent[]): boolean =>
  !e.allDay &&
  e.myStatus !== 'declined' &&
  list.some(
    (o) => o !== e && !o.allDay && o.myStatus !== 'declined' && eventBounds(o).start < eventBounds(e).end && eventBounds(e).start < eventBounds(o).end
  )

function relativeDay(day: Date, now: Date): string {
  const d = differenceInCalendarDays(day, now)
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d === -1 ? 'yesterday' : d > 0 ? `in ${d} days` : `${-d} days ago`
}

/** A styled run of text in a line. */
type Part = { text: string; color?: string; bold?: boolean; strike?: boolean }

/** Parts cut to exactly `w` cells (the last visible part gets "…"), padded with spaces so highlights span the row. */
function fitParts(parts: Part[], w: number): Part[] {
  const out: Part[] = []
  let left = w
  for (const p of parts) {
    if (left <= 0) break
    if (p.text.length <= left) {
      out.push(p)
      left -= p.text.length
    } else {
      out.push({ ...p, text: p.text.slice(0, Math.max(left - 1, 0)) + '…' })
      left = 0
    }
  }
  if (left > 0) out.push({ text: ' '.repeat(left) })
  return out
}

function Line({ parts, inverse, muted }: { parts: Part[]; inverse?: boolean; muted?: boolean }) {
  return (
    <Text inverse={inverse}>
      {parts.map((p, i) => (
        <Text key={i} color={muted && !inverse ? C.muted : p.color} bold={p.bold || inverse} strikethrough={p.strike}>
          {p.text}
        </Text>
      ))}
    </Text>
  )
}

const TIME_W = 9 // "  07:00  " / " all day "

/** Day heading, event card (2 lines), today's red now-line, or a run of free days. */
type Row = { day: Date } | { day: Date; e: CalEvent } | { day: Date; nowLine: true } | { free: [Date, Date] }
const linesOf = (r: Row): number => ('e' in r ? 2 : 1)

export function Agenda({ events, date, now, selectedKey, width, height, onSelect, onOpen, onPickDay }: ViewProps) {
  const { colorOf, accountOf, calendarOf } = useOwnerOf()
  const rows = useMemo(() => {
    const out: Row[] = []
    for (let i = 0; i < AGENDA_DAYS; i++) {
      const day = addDays(startOfDay(date), i)
      const list = eventsOnDay(events, day)
      if (!list.length) {
        const last = out.at(-1)
        if (last && 'free' in last) last.free[1] = day
        else out.push({ free: [day, day] })
        continue
      }
      const items: Row[] = list.map((e) => ({ day, e }))
      if (isSameDay(day, now)) {
        // between the last event that has started and the next one
        const next = list.findIndex((e) => eventBounds(e).start > now)
        items.splice(next < 0 ? items.length : next, 0, { day, nowLine: true })
      }
      out.push({ day }, ...items)
    }
    return out
  }, [events, date, now])

  // Scrolling works in lines (cards take two).
  const offsets: number[] = []
  let total = 0
  for (const r of rows) {
    offsets.push(total)
    total += linesOf(r)
  }
  const sel = rows.findIndex((r) => 'e' in r && eventKey(r.e) === selectedKey)
  // keep the day heading above the selection visible when it's the day's first event
  const first = sel > 0 && !('e' in rows[sel - 1]) && !('nowLine' in rows[sel - 1]) ? offsets[sel - 1] : offsets[Math.max(sel, 0)] ?? 0
  const top = useScroll(first, sel >= 0 ? offsets[sel] + 1 : 0, height, total)

  if (!events.length) return <Text color={C.muted}>No events in the next {AGENDA_DAYS} days</Text>

  // the first event still ahead today gets an "in 25m" badge
  const upNext = events.filter((e) => !e.allDay && eventBounds(e).start > now && isSameDay(eventBounds(e).start, now))
    .sort((a, b) => +eventBounds(a).start - +eventBounds(b).start)[0]

  const lines: ReactNode[] = []
  rows.forEach((r, i) => {
    const key = 'free' in r ? `free${ymd(r.free[0])}` : 'e' in r ? `${ymd(r.day)}/${eventKey(r.e)}` : 'nowLine' in r ? `${ymd(r.day)}/now` : ymd(r.day)
    if ('free' in r) {
      const [a, b] = r.free
      const label = isSameDay(a, b) ? format(a, 'EEE d MMM') : `${format(a, 'EEE d MMM')} – ${format(b, 'EEE d MMM')}`
      lines.push(
        <Box key={key} width={width} height={1} overflow="hidden">
          <Text color={C.muted} wrap="truncate">{` ${label}  free`}</Text>
        </Box>
      )
      return
    }
    if ('nowLine' in r) {
      lines.push(
        <Box key={key} width={width} height={1} overflow="hidden">
          <Text color={C.now} bold wrap="truncate">
            {`  ${format(now, 'HH:mm')} ${'─'.repeat(width)}`}
          </Text>
        </Box>
      )
      return
    }
    if (!('e' in r)) {
      const today = isSameDay(r.day, now)
      const list = eventsOnDay(events, r.day)
      const busy = busyMinutes(list, r.day)
      const left = ` ${format(r.day, 'EEE d MMM')}  `
      const rel = relativeDay(r.day, now)
      const right = ` ${list.length} ${list.length === 1 ? 'event' : 'events'}${busy ? ` · ${span(busy)} busy` : ''} `
      const rule = '─'.repeat(Math.max(width - left.length - rel.length - right.length - 1, 1))
      lines.push(
        <Clickable key={key} width={width} height={1} onClick={onPickDay && (() => onPickDay(r.day))}>
          <Text wrap="truncate">
            <Text bold color={today ? C.now : C.accent}>{left}</Text>
            <Text color={today ? C.now : C.muted}>{rel}</Text>
            <Text color={C.muted}>{` ${rule}${right}`}</Text>
          </Text>
        </Clickable>
      )
      return
    }

    const e = r.e
    const selected = i === sel
    const { start, end } = eventBounds(e)
    const running = !e.allDay && start <= now && now < end
    const past = isPast(e, now) || e.myStatus === 'declined'
    const clockOf = (d: Date, edge: string): string => (isSameDay(d, r.day) ? format(d, 'HH:mm') : +d === +addDays(r.day, 1) ? '24:00' : edge)

    const badges: Part[] = []
    if (running) badges.push({ text: `  ● now · ends in ${span(Math.max(differenceInMinutes(end, now, { roundingMethod: 'ceil' }), 1))}`, color: C.green, bold: true })
    else if (e === upNext) badges.push({ text: `  ${startsLabel(e.start, now)}`, color: C.yellow })
    if (e.myStatus === 'needsAction') badges.push({ text: '  RSVP', color: C.yellow, bold: true })
    if (e.myStatus === 'tentative') badges.push({ text: '  maybe', color: C.yellow })
    if (e.myStatus === 'declined') badges.push({ text: '  declined', color: C.muted })
    const dur = e.allDay ? '' : duration(e)
    const titleW = Math.max(width - TIME_W - 2 - (dur ? dur.length + 2 : 0), 1)
    const row1 = [
      { text: (e.allDay ? ' all day' : `  ${clockOf(start, '…')}`).padEnd(TIME_W), color: running ? C.green : undefined, bold: running },
      { text: '▌ ', color: colorOf(e) },
      ...fitParts([{ text: `${rsvpMark(e)}${e.title || '(no title)'}`, bold: true, strike: e.myStatus === 'declined' }, ...badges], titleW),
      ...(dur ? [{ text: `  ${dur}`, color: C.muted }] : [])
    ]

    const who = [accountOf(e), calendarOf(e)].filter((x, j, a) => x && a.indexOf(x) === j).join(' · ')
    const details: Part[] = [{ text: who, color: C.muted }]
    if (e.recurringEventId) details.push({ text: '  ↻ repeats', color: C.muted })
    if (overlaps(e, eventsOnDay(events, r.day))) details.push({ text: '  ⚠ overlaps', color: C.yellow })
    const where = place(e.location)
    if (where) details.push({ text: `  ${where}`, color: C.cyan })
    if (e.attendees.length) details.push({ text: `  ${e.attendees.length} ${e.attendees.length === 1 ? 'person' : 'people'}`, color: C.muted })
    const row2 = [
      { text: `  ${e.allDay ? '' : clockOf(end, '…')}`.padEnd(TIME_W), color: C.muted },
      { text: '▌ ', color: colorOf(e) },
      ...fitParts(details, width - TIME_W - 2)
    ]

    const onClick = clickEvent(e, selected, { onSelect, onOpen })
    lines.push(
      <Clickable key={key} width={width} height={1} onClick={onClick}>
        <Line parts={row1} inverse={selected} muted={past} />
      </Clickable>,
      <Clickable key={`${key}/2`} width={width} height={1} onClick={onClick}>
        <Line parts={row2} inverse={selected} muted={past} />
      </Clickable>
    )
  })

  return (
    <Box flexDirection="column" width={width}>
      {lines.slice(top, top + height)}
    </Box>
  )
}
