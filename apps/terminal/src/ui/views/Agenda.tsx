/**
 * Agenda (default view): scrollable list of events grouped by day, AGENDA_DAYS days from `date`.
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Keys: the App shell owns them all (a d w m, h/l ←/→, t, j/k ↓/↑ select, enter open, n i s r ? q).
 * The view must keep the selected event scrolled into view within `height` rows. It may add useInput
 * handlers only for keys the shell does not use.
 *
 * Also exports the small row helpers (useColorOf, useScroll, EventMark) the Day view reuses.
 */
import { useMemo, useRef, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { eventBounds, eventsOnDay, isPast, ymd } from '@multicals/core/logic/layout'
import { STATUS_ICON } from '@multicals/core/logic/details'
import type { CalEvent } from '@multicals/core/shared/types'
import { AGENDA_DAYS, eventKey, useDirectory, type ViewProps } from '../hooks'

/** Event color: its calendar's, else its account's (same fallback chain as the desktop app). */
export function useColorOf(): (e: CalEvent) => string {
  const { accounts, calendars } = useDirectory()
  return useMemo(() => {
    const cal = new Map(calendars.map((c) => [`${c.accountId}/${c.id}`, c.color]))
    const acc = new Map(accounts.map((a) => [a.id, a.color]))
    return (e) => cal.get(`${e.accountId}/${e.calendarId}`) ?? acc.get(e.accountId) ?? '#6272a4'
  }, [accounts, calendars])
}

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

/** Row style shared by views: selected = inverse, past/declined = dim, declined = struck through. */
export function EventMark({ e, now, selected, children }: { e: CalEvent; now: Date; selected: boolean; children: ReactNode }) {
  const declined = e.myStatus === 'declined'
  return (
    <Text inverse={selected} dimColor={isPast(e, now) || declined} strikethrough={declined}>
      {children}
    </Text>
  )
}

const clock = (d: Date, day: Date, edge: string): string => (isSameDay(d, day) ? format(d, 'HH:mm') : edge)

/** "09:00–10:00", "all day", or "…–10:00" / "22:00–…" for events crossing midnight. */
function timeLabel(e: CalEvent, day: Date): string {
  if (e.allDay) return 'all day'
  const { start, end } = eventBounds(e)
  // an event ending exactly at next midnight still reads "22:00–24:00"
  const endLabel = +end === +addDays(day, 1) ? '24:00' : clock(end, day, '…')
  return `${clock(start, day, '…')}–${endLabel}`
}

type Row = { day: Date } | { day: Date; e: CalEvent }

export function Agenda({ events, date, now, selectedKey, width, height }: ViewProps) {
  const colorOf = useColorOf()
  const rows = useMemo(() => {
    const out: Row[] = []
    for (let i = 0; i < AGENDA_DAYS; i++) {
      const day = addDays(startOfDay(date), i)
      const list = eventsOnDay(events, day)
      if (!list.length) continue
      out.push({ day }, ...list.map((e) => ({ day, e })))
    }
    return out
  }, [events, date])

  const sel = rows.findIndex((r) => 'e' in r && eventKey(r.e) === selectedKey)
  // keep the day header above the selection visible when it's the day's first event
  const first = sel > 0 && !('e' in rows[sel - 1]) ? sel - 1 : Math.max(sel, 0)
  const top = useScroll(first, Math.max(sel, 0), height, rows.length)

  if (!rows.length) return <Text dimColor>No events</Text>

  return (
    <Box flexDirection="column" width={width}>
      {rows.slice(top, top + height).map((r) =>
        'e' in r ? (
          <Box key={`${ymd(r.day)}/${eventKey(r.e)}`} width={width}>
            <Text wrap="truncate">
              {'  '}
              <Text color={colorOf(r.e)}>●</Text>{' '}
              <EventMark e={r.e} now={now} selected={eventKey(r.e) === selectedKey}>
                {timeLabel(r.e, r.day).padEnd(11)} {rsvpMark(r.e)}
                {r.e.title || '(no title)'}
              </EventMark>
            </Text>
          </Box>
        ) : (
          <Box key={ymd(r.day)} width={width}>
            <Text wrap="truncate" bold color={isSameDay(r.day, now) ? 'yellow' : 'cyan'}>
              {format(r.day, 'EEE d MMM')}
              {isSameDay(r.day, now) ? ' · today' : ''}
            </Text>
          </Box>
        )
      )}
    </Box>
  )
}
