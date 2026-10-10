/**
 * Time-grid table shared by the Day, 2 Days and Week views (the terminal take on desktop views/TimeGrid.tsx).
 *
 *   ------ │ Mon 21 ·2    │ Tue 22 ·3    │   head: click a day to open it in the day view
 *   all    │ Offsite      │              │   all-day titles, "+k more" on overflow
 *   ───────┼──────────────┼──────────────┤
 *   09:00  │ 09:00 Standup│              │   one row per hour; events are colored blocks (calendar color),
 *   10:00  │ Room 3 · 1h  │              │   next rows: place · duration (narrow columns: title, times, place)
 *   23:37 ─┼──────────────┼──────────────┤   current hour: red clock and a red now-line across the grid (free cells;
 *                                              bright on today, dim on the other days)
 *
 * Overlapping events share an hour side by side (core `layoutDay` + `packColumns`, snapped to whole hours). When they
 * would get under MIN_BLOCK cells each, the ones that don't fit fold into a "+k" cell that opens the day view.
 * A block with another one right below it (back-to-back events) underlines its last row, so the two don't merge.
 * Cursor day (←/→): inverse column heading. Selected block: accent-colored block. Past: muted. Declined: struck through. Unanswered invite: italic.
 * Click an event to select it (again to open it); free cells ignore clicks. The wheel scrolls the hours.
 * Keys: none of its own; the App shell owns them all.
 */
import { useMemo, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { format, isSameDay } from 'date-fns'
import { eventBounds, eventsOnDay, isPast, layoutDay, packColumns, type Placed } from '@mysticals/core/logic/layout'
import { awaitsReply } from '@mysticals/core/logic/details'
import type { CalEvent } from '@mysticals/core/shared/types'
import { eventKey, type ViewProps } from '../hooks'
import { Clickable } from '../mouse'
import { duration } from '../screens/EventDetails'
import { C } from '../theme'
import { useScroll } from '../scroll'
import { clickEvent, eventPlace, fitCells, rsvpMark, useColorOf } from './Agenda'
import { fit } from './Month'

const GUTTER = 6 // "09:00 "
const ALL_DAY_MAX = 3
/** Column width under which blocks show the title before the time. */
const COMPACT_BELOW = 18
/** Fewest cells an event block gets beside others; narrower ones fold into "+k". */
const MIN_BLOCK = 6

/** Day heading that fits `w` cells: "Mon 21", else "Mo 21", else "21" (the trailing space goes first). */
const dayLabel = (day: Date, w: number): string =>
  ['EEE d', 'EEEEEE d', 'd'].flatMap((f) => [` ${format(day, f)} `, ` ${format(day, f)}`]).find((l) => l.length <= w) ?? ` ${format(day, 'd')}`

type Slot = Placed<Placed<CalEvent>>

/** Blocks whose bottom row touches the top of another block below them in the same column span. */
export function abutting(placed: Slot[]): Set<Slot> {
  const span = (p: Slot): [number, number] => [p.col / p.cols, (p.col + 1) / p.cols]
  return new Set(
    placed.filter((p) => {
      const [a, b] = span(p)
      return placed.some((q) => {
        const [c, d] = span(q)
        return q !== p && q.start === p.end && a < d && c < b
      })
    })
  )
}

/** Hour-snapped packing so two events sharing an hour row never share a column. */
function slots(events: CalEvent[], day: Date): Slot[] {
  return packColumns(
    layoutDay(events, day).map((p) => {
      const start = Math.floor(p.start / 60) * 60
      return { item: p, start, end: Math.max(Math.ceil(p.end / 60) * 60, start + 60) }
    })
  )
}

export function TimeGrid({ days, events, now, cursor, selectedKey, width, height, onSelect, onOpen, onPickDay }: ViewProps & { days: Date[] }) {
  const colorOf = useColorOf()
  const cols = useMemo(
    () =>
      days.map((day) => {
        const on = eventsOnDay(events, day)
        const placed = slots(events, day)
        return { day, count: on.length, allDay: on.filter((e) => e.allDay), placed, joined: abutting(placed) }
      }),
    [events, days]
  )

  const colW = Math.max(Math.floor((width - GUTTER) / days.length) - 1, 3) // -1 for the "│" before each column
  const allRows = Math.min(Math.max(0, ...cols.map((c) => c.allDay.length)), ALL_DAY_MAX)
  const gridH = Math.max(height - 2 - allRows, 1) // head + rule

  const sel = cols.flatMap((c) => c.placed).find((p) => eventKey(p.item.item) === selectedKey)
  const today = days.some((d) => isSameDay(d, now))
  const focus = sel ? sel.start / 60 : today ? now.getHours() : 8
  const [top, scrollBy] = useScroll(sel ? focus : Math.max(focus - 1, 0), focus, gridH, 24)

  const bar = <Text color={C.muted}>│</Text>
  const row = (key: string, gutter: ReactNode, cells: (c: (typeof cols)[number]) => ReactNode, sep: ReactNode = bar): ReactNode => (
    <Box key={key} width={width} height={1} overflow="hidden">
      {gutter}
      {cols.map((c) => (
        <Box key={c.day.getTime()} flexShrink={0}>
          {sep}
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

  const fits = Math.max(Math.floor(colW / MIN_BLOCK), 1)
  /** Slots overlapping hour `h` (by column), and those folded into "+k" there (none, or two and more). */
  const hourSlots = (placed: Slot[], h: number): { segs: Slot[]; folded: Slot[] } => {
    const segs = placed.filter((p) => p.start < (h + 1) * 60 && p.end > h * 60).sort((a, b) => a.col - b.col)
    // with more side-by-side columns than fit, the last one that fits shows "+k" for the rest (a lone one just moves there)
    const over = segs.filter((p) => p.cols > fits && p.col >= fits - 1)
    return { segs, folded: over.length > 1 ? over : [] }
  }
  const foldKey = (placed: Slot[], h: number): string => hourSlots(placed, h).folded.map((p) => eventKey(p.item.item)).join()

  /** One column's cells for hour `h`: event blocks, gaps filled with blanks (or the red now-line, dim off today). */
  const hourCells = ({ placed, day, joined }: (typeof cols)[number], h: number, nowLine: false | 'today' | 'other'): ReactNode[] => {
    const out: ReactNode[] = []
    let pos = 0
    const gap = (to: number): void => {
      if (to <= pos) return
      out.push(
        <Box key={`g${pos}`} width={to - pos} flexShrink={0}>
          <Text color={C.now} dimColor={nowLine === 'other'}>{(nowLine ? '─' : ' ').repeat(to - pos)}</Text>
        </Box>
      )
      pos = to
    }
    const { segs, folded } = hourSlots(placed, h)
    for (const p of segs) {
      if (folded.includes(p)) continue
      const e = p.item.item
      const cols = Math.min(p.cols, fits)
      const col = Math.min(p.col, cols - 1)
      const x = Math.floor((col * colW) / cols)
      const w = Math.floor(((col + 1) * colW) / cols) - x
      if (w < 1) continue
      gap(x)
      const k = eventKey(e)
      const selected = k === selectedKey
      const first = p.start / 60
      const { start, end } = eventBounds(e)
      const from = isSameDay(start, day) ? format(start, 'HH:mm') : '…'
      const title = `${rsvpMark(e)}${e.title || '(no title)'}`
      const where = eventPlace(e)
      // narrow columns (week) put the title first and the times below; wide ones fit time + title on one row
      // (the row already names the hour, so a one-row block only adds its minutes when they aren't :00)
      const lines =
        colW < COMPACT_BELOW
          ? [p.end - p.start > 60 || start.getMinutes() === 0 ? title : `:${format(start, 'mm')} ${title}`, `${from}–${isSameDay(end, day) ? format(end, 'HH:mm') : '…'}`, where]
          : [`${from} ${title}`, [where, duration(e)].filter(Boolean).join(' · ')]
      const text = lines[h - first] ?? ''
      // a block leaves its last cell free when a neighbour follows, so side-by-side blocks stay apart
      const inner = col < cols - 1 && w > 1 ? w - 1 : w
      const past = isPast(e, now) || e.myStatus === 'declined'
      out.push(
        <Clickable key={k} width={w} flexShrink={0} onClick={clickEvent(e, selected, { onSelect, onOpen })}>
          <Text
            inverse // block in the calendar's color, text in the terminal background
            color={selected ? C.accent : past ? C.muted : colorOf(e)}
            bold={selected || h === first}
            italic={awaitsReply(e)}
            strikethrough={e.myStatus === 'declined'}
            underline={h === p.end / 60 - 1 && joined.has(p)}
          >
            {fitCells(' ' + text, inner)}
          </Text>
        </Clickable>
      )
      pos = x + w
    }
    if (folded.length) {
      const x = Math.floor(((fits - 1) * colW) / fits)
      gap(x)
      const hasSelected = folded.some((p) => eventKey(p.item.item) === selectedKey)
      const many = ` ${folded.length} events`
      // labelled where the folded set starts or changes, like a block's title on its first row
      const label = h === top || foldKey(placed, h) !== foldKey(placed, h - 1) ? (many.length <= colW - x ? many : ` +${folded.length}`) : ''
      out.push(
        <Clickable key="more" width={colW - x} flexShrink={0} onClick={onPickDay && (() => onPickDay(day))}>
          <Text inverse color={hasSelected ? C.accent : C.muted}>
            {fitCells(label, colW - x)}
          </Text>
        </Clickable>
      )
      pos = colW
    }
    gap(colW)
    return out
  }

  return (
    <Box flexDirection="column" width={width}>
      {row('head', gutterText(''), (c) => {
        const isToday = isSameDay(c.day, now)
        const label = dayLabel(c.day, colW)
        const here = !!cursor && isSameDay(c.day, cursor) && days.length > 1
        return (
          <Clickable height={1} width={colW} onClick={onPickDay && (() => onPickDay(c.day))}>
            <Text wrap="truncate">
              <Text bold inverse={here} color={isToday ? C.now : C.accent}>
                {label}
              </Text>
              {c.count > 0 && label.length + `·${c.count}`.length <= colW && <Text color={C.muted}>·{c.count}</Text>}
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
              <Text wrap="truncate" inverse={selected} color={selected ? C.accent : C.yellow} bold={selected}>
                <Text color={selected ? C.accent : colorOf(e)}> ●</Text> {rsvpMark(e)}
                {e.title || '(no title)'}
              </Text>
            </Clickable>
          )
        })
      )}
      <Box width={width} height={1} overflow="hidden">
        <Text color={C.muted}>{'─'.repeat(GUTTER) + ('┼' + '─'.repeat(colW)).repeat(days.length)}</Text>
      </Box>
      <Clickable flexDirection="column" width={width} onWheel={(dir) => scrollBy(dir)}>
      {Array.from({ length: Math.min(gridH, 24) }, (_, i) => {
        const h = top + i
        const current = today && h === now.getHours()
        const gutter = (
          <Box width={GUTTER} flexShrink={0}>
            <Text color={current ? C.now : C.muted} bold={current}>
              {current ? `${format(now, 'HH:mm')}─` : `${String(h).padStart(2, '0')}:00`}
            </Text>
          </Box>
        )
        return row(
          `h${h}`,
          gutter,
          (c) => hourCells(c, h, current && (isSameDay(c.day, now) ? 'today' : 'other')),
          current ? <Text color={C.now}>┼</Text> : bar
        )
      })}
      </Clickable>
    </Box>
  )
}
