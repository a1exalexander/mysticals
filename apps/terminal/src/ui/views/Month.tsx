/**
 * Month view: 6x7 grid (core `monthGrid(date)`), a few event titles per cell plus "+k".
 * Weekday header row, then per cell the day number (outside-month dimmed, today highlighted) and as many titles as
 * the cell height allows; the selected event is highlighted and kept visible inside its cell. Today is red.
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Clicks: an event selects it (again opens it), a day number opens the day view.
 * Keys: none of its own; the App shell owns them all.
 */
import { Box, Text } from 'ink'
import { format, isSameDay, isSameMonth, startOfDay } from 'date-fns'
import { eventBounds, eventsOnDay, isPast, monthGrid } from '@multicals/core/logic/layout'
import type { CalEvent } from '@multicals/core/shared/types'
import { eventKey, type ViewProps } from '../hooks'
import { Clickable } from '../mouse'
import { C } from '../theme'
import { clickEvent } from './Agenda'

/** Picks at most `rows` lines of `items` (the last one becoming "+k more" on overflow), scrolled to keep `selected`. */
export function fit<T>(items: T[], rows: number, selected: number): { shown: T[]; more: number } {
  if (items.length <= rows) return { shown: items, more: 0 }
  // A single row can't hold both an event and "+k": the selection wins.
  if (rows === 1 && selected >= 0) return { shown: [items[selected]], more: 0 }
  const n = Math.max(rows - 1, 0)
  const from = Math.max(0, Math.min(selected - n + 1, items.length - n))
  return { shown: items.slice(from, from + n), more: items.length - n }
}

/** One truncated event line; `time` prefixes timed events with their start (or "…" when continuing from earlier). */
export function EventLine({ e, day, now, selected, time, onSelect, onOpen }: {
  e: CalEvent
  day: Date
  now: Date
  selected: boolean
  time: boolean
} & Pick<ViewProps, 'onSelect' | 'onOpen'>) {
  const { start, end } = eventBounds(e)
  const prefix = !time || e.allDay ? '' : start < startOfDay(day) ? '…     ' : `${format(start, 'HH:mm')} `
  const live = !e.allDay && start <= now && now < end
  return (
    <Clickable height={1} onClick={clickEvent(e, selected, { onSelect, onOpen })}>
      <Text
        wrap="truncate-end"
        inverse={selected}
        bold={selected}
        italic={e.myStatus === 'needsAction'}
        strikethrough={e.myStatus === 'declined'}
        color={selected ? undefined : isPast(e, now) || e.myStatus === 'declined' ? C.muted : live ? C.green : e.allDay ? C.yellow : undefined}
      >
        {prefix}
        {e.title}
      </Text>
    </Clickable>
  )
}

export function Month({ events, date, now, cursor, selectedKey, width, height, onSelect, onOpen, onPickDay }: ViewProps) {
  const days = monthGrid(date)
  const colWidth = Math.max(Math.floor(width / 7), 4)
  const cellHeight = Math.max(Math.floor((height - 1) / 6), 1)
  const weeks = [0, 1, 2, 3, 4, 5].map((w) => days.slice(w * 7, w * 7 + 7))
  return (
    <Box flexDirection="column">
      <Box>
        {weeks[0].map((d) => (
          <Box key={d.getDay()} width={colWidth}>
            <Text color={C.accent} bold>{format(d, 'EEE')}</Text>
          </Box>
        ))}
      </Box>
      {weeks.map((week) => (
        <Box key={week[0].toISOString()} height={cellHeight}>
          {week.map((day) => {
            const items = eventsOnDay(events, day)
            const { shown, more } = fit(items, cellHeight - 1, items.findIndex((e) => eventKey(e) === selectedKey))
            const today = isSameDay(day, now)
            const here = !!cursor && isSameDay(day, cursor)
            return (
              <Box key={day.toISOString()} flexDirection="column" width={colWidth} paddingRight={1} overflow="hidden">
                {/* today: red; cursor day (←/→ ↑/↓): inverse */}
                <Clickable height={1} onClick={onPickDay && (() => onPickDay(day))}>
                  <Text
                    bold={today || here}
                    inverse={here}
                    color={today ? C.now : here ? C.accent : isSameMonth(day, date) ? undefined : C.muted}
                  >
                    {here ? ` ${format(day, 'd')} ` : format(day, 'd')}
                    {cellHeight === 1 && items.length > 0 && <Text color={C.muted}> ·{items.length}</Text>}
                  </Text>
                </Clickable>
                {shown.map((e) => (
                  <EventLine key={eventKey(e)} e={e} day={day} now={now} selected={eventKey(e) === selectedKey} time={false} onSelect={onSelect} onOpen={onOpen} />
                ))}
                {more > 0 && cellHeight > 1 && <Text color={C.muted}>+{more}</Text>}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
