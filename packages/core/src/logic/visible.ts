import type { Calendar, CalEvent } from '../shared/types'

/** Identity of a calendar across accounts. */
export const key = (accountId: string, calendarId: string): string => `${accountId}/${calendarId}`

/** Drops events of calendars the user hid (events.list returns all calendars so toggles are instant). */
export const visibleEvents = (events: CalEvent[], calendars: Calendar[]): CalEvent[] => {
  const hidden = new Set(calendars.filter((c) => c.visible === false).map((c) => key(c.accountId, c.id)))
  return hidden.size ? events.filter((e) => !hidden.has(key(e.accountId, e.calendarId))) : events
}
