/**
 * Week view: 7 day columns (core `viewDays('week', date)`, Monday first), events listed per day.
 * Column: `EEE d` header (today highlighted), all-day titles, then `HH:mm title` lines truncated to the column.
 * Selected event is inverse, past/declined dimmed, pending invites italic; overflow collapses into "+k more"
 * while keeping the selected event in view.
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Keys: none of its own; the App shell owns them all (a d w m, h/l ←/→, t, j/k ↓/↑ select, enter open, n i s r ? q).
 */
import { Box, Text } from 'ink'
import { format, isSameDay, startOfDay } from 'date-fns'
import { eventBounds, eventsOnDay, isPast, viewDays } from '@multicals/core/logic/layout'
import type { CalEvent } from '@multicals/core/shared/types'
import { eventKey, type ViewProps } from '../hooks'

/** Picks at most `rows` lines of `items` (the last one becoming "+k more" on overflow), scrolled to keep `selected`. */
export function fit<T>(items: T[], rows: number, selected: number): { shown: T[]; more: number } {
  if (items.length <= rows) return { shown: items, more: 0 }
  const n = Math.max(rows - 1, 0)
  const from = Math.max(0, Math.min(selected - n + 1, items.length - n))
  return { shown: items.slice(from, from + n), more: items.length - n }
}

/** One truncated event line; `time` prefixes timed events with their start (or "…" when continuing from earlier). */
export function EventLine({ e, day, now, selected, time }: { e: CalEvent; day: Date; now: Date; selected: boolean; time: boolean }) {
  const start = eventBounds(e).start
  const prefix = !time || e.allDay ? '' : start < startOfDay(day) ? '…     ' : `${format(start, 'HH:mm')} `
  return (
    <Text
      wrap="truncate-end"
      inverse={selected}
      dimColor={!selected && (isPast(e, now) || e.myStatus === 'declined')}
      italic={e.myStatus === 'needsAction'}
      color={e.allDay && !selected ? 'yellow' : undefined}
    >
      {prefix}
      {e.title}
    </Text>
  )
}

export function Week({ events, date, now, selectedKey, width, height }: ViewProps) {
  const colWidth = Math.max(Math.floor(width / 7), 4)
  return (
    <Box>
      {viewDays('week', date).map((day) => {
        const items = eventsOnDay(events, day)
        const { shown, more } = fit(items, height - 1, items.findIndex((e) => eventKey(e) === selectedKey))
        const today = isSameDay(day, now)
        return (
          <Box key={day.toISOString()} flexDirection="column" width={colWidth} paddingRight={1}>
            <Text bold inverse={today} color={today ? 'cyan' : undefined} wrap="truncate-end">
              {format(day, 'EEE d')}
            </Text>
            {shown.map((e) => (
              <EventLine key={eventKey(e)} e={e} day={day} now={now} selected={eventKey(e) === selectedKey} time />
            ))}
            {more > 0 && <Text dimColor wrap="truncate-end">+{more} more</Text>}
          </Box>
        )
      })}
    </Box>
  )
}
