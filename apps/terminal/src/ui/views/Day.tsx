/**
 * Day view: all-day events on top, then a time grid / timed list for `date`.
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Keys: the App shell owns them all (a d w m, h/l ←/→, t, j/k ↓/↑ select, enter open, n i s r ? q).
 * It may add useInput handlers only for keys the shell does not use.
 *
 * One row per hour; overlapping events share the row side by side (core `layoutDay` + `packColumns`).
 */
import { useMemo, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { format, isSameDay } from 'date-fns'
import { eventBounds, eventsOnDay, layoutDay, packColumns } from '@multicals/core/logic/layout'
import { eventKey, type ViewProps } from '../hooks'
import { EventMark, rsvpMark, useColorOf, useScroll } from './Agenda'

const GUTTER = 6 // "09:00 "
const ALL_DAY_MAX = 3

export function Day({ events, date, now, selectedKey, width, height }: ViewProps) {
  const colorOf = useColorOf()
  const allDay = useMemo(() => eventsOnDay(events, date).filter((e) => e.allDay), [events, date])
  // Snap to whole hours before packing so two events sharing an hour row never share a column.
  const placed = useMemo(
    () =>
      packColumns(
        layoutDay(events, date).map((p) => {
          const start = Math.floor(p.start / 60) * 60
          return { item: p, start, end: Math.max(Math.ceil(p.end / 60) * 60, start + 60) }
        })
      ),
    [events, date]
  )

  // All-day strip is capped; the rest collapse into "+N more" except a selected one, which takes the last slot.
  const selAll = allDay.findIndex((e) => eventKey(e) === selectedKey)
  const cut = ALL_DAY_MAX - 1
  const strip =
    allDay.length <= ALL_DAY_MAX ? allDay : selAll >= cut ? [...allDay.slice(0, cut - 1), allDay[selAll]] : allDay.slice(0, cut)
  const stripRows = strip.length + (strip.length < allDay.length ? 1 : 0)
  const gridH = Math.max(height - stripRows, 1)

  const sel = placed.find((p) => eventKey(p.item.item) === selectedKey)
  const isToday = isSameDay(date, now)
  const focus = sel ? sel.start / 60 : isToday ? now.getHours() : 8
  const top = useScroll(sel ? focus : Math.max(focus - 1, 0), focus, gridH, 24)

  const W = Math.max(width - GUTTER, 1)
  const hourRow = (h: number): ReactNode[] => {
    const out: ReactNode[] = []
    let pos = 0
    const segs = placed.filter((p) => p.start < (h + 1) * 60 && p.end > h * 60).sort((a, b) => a.col - b.col)
    for (const p of segs) {
      const e = p.item.item
      const x = Math.floor((p.col * W) / p.cols)
      const w = Math.floor(((p.col + 1) * W) / p.cols) - x
      if (w < 1) continue
      if (x > pos) out.push(' '.repeat(x - pos))
      pos = x + w
      const head = h === p.start / 60
      const k = eventKey(e)
      const { start } = eventBounds(e)
      const label = head ? `${isSameDay(start, date) ? format(start, 'HH:mm') : '…'} ${rsvpMark(e)}${e.title || '(no title)'}` : ''
      out.push(
        <Text key={k}>
          <Text color={colorOf(e)}>{head ? '●' : '│'}</Text>
          {w > 2 && (
            <EventMark e={e} now={now} selected={k === selectedKey}>
              {(' ' + label).slice(0, w - 2).padEnd(w - 2)}
            </EventMark>
          )}
          {w > 1 && ' '}
        </Text>
      )
    }
    return out
  }

  const line = (key: string, children: ReactNode): ReactNode => (
    <Box key={key} width={width}>
      <Text wrap="truncate">{children}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" width={width}>
      {strip.map((e) =>
        line(eventKey(e), [
          <Text key="g">{'all  '.padEnd(GUTTER)}</Text>,
          <Text key="c" color={colorOf(e)}>●</Text>,
          ' ',
          <EventMark key="t" e={e} now={now} selected={eventKey(e) === selectedKey}>
            {rsvpMark(e)}
            {e.title || '(no title)'}
          </EventMark>
        ])
      )}
      {strip.length < allDay.length && line('more', <Text dimColor>{' '.repeat(GUTTER)}+{allDay.length - strip.length} more all-day</Text>)}
      {Array.from({ length: Math.min(gridH, 24) }, (_, i) => {
        const h = top + i
        const current = isToday && h === now.getHours()
        return line(`h${h}`, [
          <Text key="g" color={current ? 'yellow' : undefined} bold={current} dimColor={!current}>
            {`${String(h).padStart(2, '0')}:00`.padEnd(GUTTER)}
          </Text>,
          ...hourRow(h)
        ])
      })}
    </Box>
  )
}
