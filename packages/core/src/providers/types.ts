import type { Calendar, CalEvent, DeleteScope, Credentials, NewEventInput, PartStat, Recurrence, TimeRange } from '../shared/types'

/**
 * One instance per account. Knows ONLY its own account id, identity and credentials.
 * Must never read the account registry or other accounts' data.
 */
export interface CalendarProvider {
  listCalendars(): Promise<Calendar[]>
  listEvents(calendarId: string, range: TimeRange): Promise<CalEvent[]>
  createEvent(calendarId: string, input: NewEventInput): Promise<CalEvent>
  updateEvent(event: CalEvent, scope?: DeleteScope): Promise<CalEvent>
  deleteEvent(event: CalEvent, scope?: DeleteScope): Promise<void>
  respond(event: CalEvent, status: Exclude<PartStat, 'needsAction'>): Promise<CalEvent>
  /** The rule of the event's series, null for a single event. */
  getRecurrence(event: CalEvent): Promise<Recurrence | null>
}

export interface ProviderContext {
  accountId: string
  email: string
  credentials: Credentials
  /** Persist refreshed credentials (e.g. new Google access token) for THIS account only. */
  saveCredentials(creds: Credentials): Promise<void>
}

export type ProviderFactory = (ctx: ProviderContext) => CalendarProvider
