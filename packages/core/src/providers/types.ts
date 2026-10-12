import type { Effect } from 'effect'
import type { Calendar, CalEvent, DeleteScope, Credentials, NewEventInput, PartStat, Recurrence, TimeRange } from '../shared/types'
import type { AppError, ProviderError } from '../errors'

/**
 * One instance per account. Knows ONLY its own account id, identity and credentials.
 * Must never read the account registry or other accounts' data.
 */
export interface CalendarProvider {
  listCalendars(): Effect.Effect<Calendar[], ProviderError>
  listEvents(calendarId: string, range: TimeRange): Effect.Effect<CalEvent[], ProviderError>
  createEvent(calendarId: string, input: NewEventInput): Effect.Effect<CalEvent, ProviderError>
  updateEvent(event: CalEvent, scope?: DeleteScope): Effect.Effect<CalEvent, ProviderError>
  deleteEvent(event: CalEvent, scope?: DeleteScope): Effect.Effect<void, ProviderError>
  respond(event: CalEvent, status: Exclude<PartStat, 'needsAction'>): Effect.Effect<CalEvent, ProviderError>
  /** The rule of the event's series, null for a single event. */
  getRecurrence(event: CalEvent): Effect.Effect<Recurrence | null, ProviderError>
}

export interface ProviderContext {
  accountId: string
  email: string
  credentials: Credentials
  /** Persist refreshed credentials (e.g. new Google access token) for THIS account only. */
  saveCredentials(creds: Credentials): Effect.Effect<void, AppError>
}

export type ProviderFactory = (ctx: ProviderContext) => Effect.Effect<CalendarProvider, ProviderError>
