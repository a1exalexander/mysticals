import { randomUUID } from 'crypto'
import type { Calendar, CalEvent, DeleteScope, NewEventInput, PartStat, TimeRange } from '../shared/types'
import type { CalendarProvider } from '../providers/types'

/** In-memory provider for tests and MYSTICALS_MOCK=1. One instance per fake account. */
export class MockProvider implements CalendarProvider {
  calendars: Calendar[]
  events: CalEvent[] = []

  constructor(
    readonly accountId: string,
    readonly email: string,
    calendars: Omit<Calendar, 'accountId'>[]
  ) {
    this.calendars = calendars.map((c) => ({ ...c, accountId }))
  }

  async listCalendars(): Promise<Calendar[]> {
    return structuredClone(this.calendars)
  }

  async listEvents(calendarId: string, range: TimeRange): Promise<CalEvent[]> {
    return structuredClone(
      this.events.filter((e) => e.calendarId === calendarId && e.end > range.start && e.start < range.end)
    )
  }

  async createEvent(calendarId: string, input: NewEventInput): Promise<CalEvent> {
    const ev: CalEvent = {
      id: randomUUID(),
      accountId: this.accountId,
      calendarId,
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      location: input.location,
      description: input.description,
      organizer: { email: this.email },
      attendees: (input.attendees ?? []).map((email) => ({ email, status: 'needsAction' as const }))
    }
    this.events.push(ev)
    return structuredClone(ev)
  }

  async updateEvent(event: CalEvent): Promise<CalEvent> {
    const i = this.events.findIndex((e) => e.id === event.id)
    if (i < 0) throw new Error('not found')
    this.events[i] = { ...event, accountId: this.accountId }
    return structuredClone(this.events[i])
  }

  async deleteEvent(event: CalEvent, scope: DeleteScope = 'one'): Promise<void> {
    const series = event.recurringEventId
    const hit = (e: CalEvent): boolean =>
      !series || scope === 'one'
        ? e.id === event.id
        : e.recurringEventId === series && (scope === 'all' || e.start >= event.start)
    this.events = this.events.filter((e) => !hit(e))
  }

  async respond(event: CalEvent, status: Exclude<PartStat, 'needsAction'>): Promise<CalEvent> {
    const ev = this.events.find((e) => e.id === event.id)
    if (!ev) throw new Error('not found')
    ev.myStatus = status
    ev.attendees = ev.attendees.map((a) => (a.self ? { ...a, status } : a))
    return structuredClone(ev)
  }
}
