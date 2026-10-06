import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { CalEvent, NewEventInput } from '../shared/types'

/** Where a copied event lands: a timed slot (ISO start) or a whole day ('YYYY-MM-DD'). */
export interface PasteSlot {
  start: string
  allDay: boolean
}

const DAY = 'yyyy-MM-dd'

/**
 * A new, standalone event with the same contents as `e` (one occurrence of a series, without its rule), at the same
 * time or moved to `at`. Guests are only kept with `guests` (an undo restoring the user's own event): a duplicate or
 * paste never invites anyone on its own.
 *
 * Moving keeps the length. A timed event dropped on a day keeps its clock time; an all-day event dropped on a time
 * stays all-day on that time's day.
 */
export function copyInput(e: CalEvent, at?: PasteSlot, { guests = false } = {}): NewEventInput {
  const attendees = guests ? e.attendees.filter((a) => !a.self && !a.organizer).map((a) => a.email) : []
  return {
    accountId: e.accountId,
    calendarId: e.calendarId,
    title: e.title,
    ...(at ? moved(e, at) : { start: e.start, end: e.end, allDay: e.allDay }),
    location: e.location || undefined,
    description: e.description || undefined,
    ...(attendees.length ? { attendees } : {})
  }
}

function moved(e: CalEvent, at: PasteSlot): Pick<NewEventInput, 'start' | 'end' | 'allDay'> {
  if (e.allDay) {
    const day = at.allDay ? parseISO(at.start) : new Date(at.start)
    const days = Math.max(1, differenceInCalendarDays(parseISO(e.end), parseISO(e.start)))
    return { allDay: true, start: format(day, DAY), end: format(addDays(day, days), DAY) }
  }
  const from = new Date(e.start)
  const length = new Date(e.end).getTime() - from.getTime()
  let start: Date
  if (at.allDay) {
    start = parseISO(at.start)
    start.setHours(from.getHours(), from.getMinutes(), 0, 0)
  } else start = new Date(at.start)
  return { allDay: false, start: start.toISOString(), end: new Date(start.getTime() + length).toISOString() }
}
