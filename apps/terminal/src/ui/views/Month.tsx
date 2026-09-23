/**
 * Month view: 6x7 grid (core `monthGrid(date)`), a few event titles per cell plus "+k".
 * Weekday header row, then per cell the day number (outside-month dimmed, today highlighted) and as many titles as
 * the cell height allows; the selected event is inverse and kept visible inside its cell.
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Keys: none of its own; the App shell owns them all (a d w m, h/l ←/→, t, j/k ↓/↑ select, enter open, n i s r ? q).
 */
import { Box, Text } from 'ink'
import { format, isSameDay, isSameMonth } from 'date-fns'
import { eventsOnDay, monthGrid } from '@multicals/core/logic/layout'
import { eventKey, type ViewProps } from '../hooks'
import { EventLine, fit } from './Week'

export function Month({ events, date, now, selectedKey, width, height }: ViewProps) {
  const days = monthGrid(date)
  const colWidth = Math.max(Math.floor(width / 7), 4)
  const cellHeight = Math.max(Math.floor((height - 1) / 6), 1)
  const weeks = [0, 1, 2, 3, 4, 5].map((w) => days.slice(w * 7, w * 7 + 7))
  return (
    <Box flexDirection="column">
      <Box>
        {weeks[0].map((d) => (
          <Box key={d.getDay()} width={colWidth}>
            <Text dimColor>{format(d, 'EEE')}</Text>
          </Box>
        ))}
      </Box>
      {weeks.map((week) => (
        <Box key={week[0].toISOString()} height={cellHeight}>
          {week.map((day) => {
            const items = eventsOnDay(events, day)
            const { shown, more } = fit(items, cellHeight - 1, items.findIndex((e) => eventKey(e) === selectedKey))
            const today = isSameDay(day, now)
            return (
              <Box key={day.toISOString()} flexDirection="column" width={colWidth} paddingRight={1} overflow="hidden">
                <Text
                  bold={today}
                  inverse={today}
                  color={today ? 'cyan' : undefined}
                  dimColor={!today && !isSameMonth(day, date)}
                >
                  {format(day, 'd')}
                  {cellHeight === 1 && items.length > 0 && <Text dimColor> ·{items.length}</Text>}
                </Text>
                {shown.map((e) => (
                  <EventLine key={eventKey(e)} e={e} day={day} now={now} selected={eventKey(e) === selectedKey} time={false} />
                ))}
                {more > 0 && cellHeight > 1 && <Text dimColor>+{more}</Text>}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
