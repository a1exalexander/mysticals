/**
 * Time-grid table shared by the Day, 2 Days and Week views (the terminal take on desktop views/TimeGrid.tsx).
 *
 *   ------ │ Mon 21 ·2    │ Tue 22 ·3    │   head: click a day to open it in the day view
 *   all    │ Offsite      │              │   all-day titles, "+k more" on overflow
 *   ───────┼──────────────┼──────────────┤
 *   09:00  │ 09:00 Standup│              │   one row per hour; events are colored blocks (calendar color),
 *   10:00  │ Room 3 · 1h  │              │   next rows: place · duration (narrow columns: title, times, place)
 *   23:37  │──────────────│              │   current hour: red clock, red now-line through today's free cells
 *
 * Overlapping events share an hour side by side (core `layoutDay` + `packColumns`, snapped to whole hours).
 * Cursor day (←/→): inverse column heading. Selected block: default-colored block. Past: muted. Declined: struck through. Unanswered invite: italic.
 * Click an event to select it (again to open it); click a free cell (or the hour, in the day view) to create one there.
 * Keys: none of its own; the App shell owns them all.
 */
import { useMemo, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { format, isSameDay, setHours, startOfDay } from 'date-fns'
import { eventBounds, eventsOnDay, isPast, layoutDay, packColumns, type Placed } from '@mysticals/core/logic/layout'
import type { CalEvent } from '@mysticals/core/shared/types'
import { eventKey, type ViewProps } from '../hooks'
import { Clickable } from '../mouse'
import { duration } from '../screens/EventDetails'
import { C } from '../theme'
import { clickEvent, place, rsvpMark, useColorOf, useScroll } from './Agenda'
import { fit } from './Month'

const GUTTER = 6 // "09:00 "
const ALL_DAY_MAX = 3
/** Column width under which blocks show the title before the time. */
const COMPACT_BELOW = 18

type Slot = Placed<Placed<CalEvent>>

/** Hour-snapped packing so two events sharing an hour row never share a column. */
function slots(events: CalEvent[], day: Date): Slot[] {
  return packColumns(
    layoutDay(events, day).map((p) => {
      const start = Math.floor(p.start / 60) * 60
      return { item: p, start, end: Math.max(Math.ceil(p.end / 60) * 60, start + 60) }
    })
  )
}

export function TimeGrid({ days, events, now, cursor, selectedKey, width, height, onSelect, onOpen, onPickDay, onCreate }: ViewProps & { days: Date[] }) {
  const colorOf = useColorOf()
  const cols = useMemo(
    () =>
      days.map((day) => {
        const on = eventsOnDay(events, day)
        return { day, count: on.length, allDay: on.filter((e) => e.allDay), placed: slots(events, day) }
      }),
    [events, days]
  )

  const colW = Math.max(Math.floor((width - GUTTER) / days.length) - 1, 3) // -1 for the "│" before each column
  const allRows = Math.min(Math.max(0, ...cols.map((c) => c.allDay.length)), ALL_DAY_MAX)
  const gridH = Math.max(height - 2 - allRows, 1) // head + rule

  const sel = cols.flatMap((c) => c.placed).find((p) => eventKey(p.item.item) === selectedKey)
  const today = days.some((d) => isSameDay(d, now))
  const focus = sel ? sel.start / 60 : today ? now.getHours() : 8
  const top = useScroll(sel ? focus : Math.max(focus - 1, 0), focus, gridH, 24)

  const bar = <Text color={C.muted}>│</Text>
  const row = (key: string, gutter: ReactNode, cells: (c: (typeof cols)[number]) => ReactNode): ReactNode => (
    <Box key={key} width={width} height={1} overflow="hidden">
      {gutter}
      {cols.map((c) => (
        <Box key={c.day.getTime()} flexShrink={0}>
          {bar}
          <Box width={colW} flexShrink={0} overflow="hidden">
            {cells(c)}
          </Box>
        </Box>
      ))}
    </Box>
  )
  const gutterText = (text: string): ReactNode => (
    <Box width={GUTTER} flexShrink={0}>
      <Text color={C.muted}>{text}</Text>
    </Box>
  )

  /** One column's cells for hour `h`: event blocks, gaps filled with blanks (or the red now-line). */
  const hourCells = (placed: Slot[], day: Date, h: number, nowLine: boolean): ReactNode[] => {
    const out: ReactNode[] = []
    let pos = 0
    // free cells: click creates an event at this day + hour
    const gap = (to: number): void => {
      if (to <= pos) return
      out.push(
        <Clickable key={`g${pos}`} width={to - pos} flexShrink={0} onClick={onCreate && (() => onCreate(setHours(startOfDay(day), h)))}>
          <Text color={C.now}>{(nowLine ? '─' : ' ').repeat(to - pos)}</Text>
        </Clickable>
      )
      pos = to
    }
    const segs = placed.filter((p) => p.start < (h + 1) * 60 && p.end > h * 60).sort((a, b) => a.col - b.col)
    for (const p of segs) {
      const e = p.item.item
      const x = Math.floor((p.col * colW) / p.cols)
      const w = Math.floor(((p.col + 1) * colW) / p.cols) - x
      if (w < 1) continue
      gap(x)
      const k = eventKey(e)
      const selected = k === selectedKey
      const first = p.start / 60
      const { start, end } = eventBounds(e)
      const from = isSameDay(start, day) ? format(start, 'HH:mm') : '…'
      const title = `${rsvpMark(e)}${e.title || '(no title)'}`
      const where = place(e.location)
      // narrow columns (week) put the title first and the times below; wide ones fit time + title on one row
      // (the row already names the hour, so a one-row block only adds its minutes when they aren't :00)
      const lines =
        colW < COMPACT_BELOW
          ? [p.end - p.start > 60 || start.getMinutes() === 0 ? title : `:${format(start, 'mm')} ${title}`, `${from}–${isSameDay(end, day) ? format(end, 'HH:mm') : '…'}`, where]
          : [`${from} ${title}`, [where, duration(e)].filter(Boolean).join(' · ')]
      const text = lines[h - first] ?? ''
      // a block leaves its last cell free when a neighbour follows, so side-by-side blocks stay apart
      const inner = p.col < p.cols - 1 && w > 1 ? w - 1 : w
      const past = isPast(e, now) || e.myStatus === 'declined'
      out.push(
        <Clickable key={k} width={w} flexShrink={0} onClick={clickEvent(e, selected, { onSelect, onOpen })}>
          <Text
            inverse // block in the calendar's color, text in the terminal background
            color={selected ? undefined : past ? C.muted : colorOf(e)}
            bold={selected || h === first}
            italic={e.myStatus === 'needsAction'}
            strikethrough={e.myStatus === 'declined'}
          >
            {(' ' + text).slice(0, inner).padEnd(inner)}
          </Text>
        </Clickable>
      )
      pos = x + w
    }
    gap(colW)
    return out
  }

  return (
    <Box flexDirection="column" width={width}>
      {row('head', gutterText(''), (c) => {
        const isToday = isSameDay(c.day, now)
        const here = !!cursor && isSameDay(c.day, cursor) && days.length > 1
        return (
          <Clickable height={1} width={colW} onClick={onPickDay && (() => onPickDay(c.day))}>
            <Text wrap="truncate">
              <Text bold inverse={here} color={isToday ? C.now : C.accent}>
                {` ${format(c.day, 'EEE d')} `}
              </Text>
              {c.count > 0 && <Text color={C.muted}>·{c.count}</Text>}
            </Text>
          </Clickable>
        )
      })}
      {Array.from({ length: allRows }, (_, i) =>
        row(`all${i}`, gutterText(i === 0 ? 'all' : ''), (c) => {
          const { shown, more } = fit(c.allDay, allRows, c.allDay.findIndex((e) => eventKey(e) === selectedKey))
          const e = shown[i]
          if (!e) return i === shown.length && more > 0 ? <Text color={C.muted}> +{more} more</Text> : null
          const selected = eventKey(e) === selectedKey
          return (
            <Clickable height={1} width={colW} onClick={clickEvent(e, selected, { onSelect, onOpen })}>
              <Text wrap="truncate" inverse={selected} color={selected ? undefined : C.yellow} bold={selected}>
                <Text color={selected ? undefined : colorOf(e)}> ●</Text> {rsvpMark(e)}
                {e.title || '(no title)'}
              </Text>
            </Clickable>
          )
        })
      )}
      <Box width={width} height={1} overflow="hidden">
        <Text color={C.muted}>{'─'.repeat(GUTTER) + ('┼' + '─'.repeat(colW)).repeat(days.length)}</Text>
      </Box>
      {Array.from({ length: Math.min(gridH, 24) }, (_, i) => {
        const h = top + i
        const current = today && h === now.getHours()
        const gutter = (
          <Clickable width={GUTTER} flexShrink={0} onClick={onCreate && days.length === 1 ? () => onCreate(setHours(startOfDay(days[0]), h)) : undefined}>
            <Text color={current ? C.now : C.muted} bold={current}>
              {current ? format(now, 'HH:mm') : `${String(h).padStart(2, '0')}:00`}
            </Text>
          </Clickable>
        )
        return row(`h${h}`, gutter, (c) => hourCells(c.placed, c.day, h, current && isSameDay(c.day, now)))
      })}
    </Box>
  )
}
