// Frozen contract shared by main + renderer. Only add optional fields.

export type AccountKind = 'google' | 'caldav'

export interface Account {
  id: string
  kind: AccountKind
  label: string
  /** The account's own identity; used as ORGANIZER for events it creates. */
  email: string
  color: string
  /** Set by sync engine when the last sync for this account failed. */
  error?: string
  /** The server rejected the stored credentials (password revoked, sign-in expired). Sync pauses until accounts.reauth. */
  authError?: boolean
  /** A sync of this account is running (set by accounts.list). */
  syncing?: boolean
  /** The account has synced at least once (set by accounts.list). */
  synced?: boolean
}

export interface Calendar {
  id: string
  accountId: string
  name: string
  color: string
  readOnly: boolean
  visible?: boolean
}

export type PartStat = 'accepted' | 'declined' | 'tentative' | 'needsAction'

export interface Attendee {
  email: string
  name?: string
  status: PartStat
  /** True when this attendee is the owning account itself. */
  self?: boolean
  organizer?: boolean
}

/** ISO 8601 strings. For allDay events: date-only 'YYYY-MM-DD', end exclusive. */
export interface CalEvent {
  id: string
  accountId: string
  calendarId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  /** Video call attached by the provider (Google Meet / conferenceData), separate from `location`. */
  conferenceUrl?: string
  description?: string
  organizer?: { email: string; name?: string }
  attendees: Attendee[]
  /** Owning account's own response when it is an invitee. */
  myStatus?: PartStat
  etag?: string
  /** Provider-specific payload (ICS text, Google resource). Opaque to renderer. */
  raw?: unknown
  /** Recurrence instance marker; providers expand series into instances. */
  recurringEventId?: string
  /** Edits only: the series' new repeat rule (null stops repeating). Absent keeps the rule. Read it with events.recurrence. */
  recurrence?: Recurrence | null
}

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

/** How an event repeats (a subset of RFC 5545 RRULE the app can edit). */
export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  /** Every N periods; default 1. */
  interval?: number
  /** Weekly only: the days it happens on (default: the start's weekday). */
  byDay?: Weekday[]
  /** Last day it may happen on, 'YYYY-MM-DD' (inclusive). */
  until?: string
  count?: number
  /** An RRULE the app can't edit (e.g. "2nd Tuesday"): shown read-only and kept as-is. */
  rule?: string
}

/** Which part of a recurring series a delete removes or an edit changes. Ignored for single events. */
export type DeleteScope = 'one' | 'following' | 'all'

export interface NewEventInput {
  accountId: string
  calendarId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
  /** Emails to invite. Never filled automatically. */
  attendees?: string[]
  recurrence?: Recurrence
}

export interface TimeRange {
  start: string
  end: string
}

export interface CaldavAccountInput {
  label: string
  serverUrl: string
  username: string
  password: string
  color?: string
}

/** Credentials kept encrypted per account; never sent to renderer. */
export type Credentials =
  | { kind: 'google'; refreshToken: string; accessToken?: string; expiresAt?: number }
  | { kind: 'caldav'; serverUrl: string; username: string; password: string }

/** What an activity-log entry records (desktop Settings → Logs). */
export type LogKind =
  | 'account.add'
  | 'account.update'
  | 'account.reauth'
  | 'account.remove'
  | 'calendar.visible'
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'event.respond'
  | 'sync'
  | 'sync.fail'
  | 'remote.add'
  | 'remote.change'
  | 'remote.remove'
  | 'notify'
  | 'reminder'

/** An event as the log keeps it: everything but provider payloads and etags. */
export interface EventSnap {
  id: string
  calendarId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  conferenceUrl?: string
  description?: string
  organizer?: { email: string; name?: string }
  attendees: Attendee[]
  myStatus?: PartStat
  recurringEventId?: string
  recurrence?: Recurrence | null
}

/** One field of an event before and after (absent side: undefined). Attendees are `attendee:<email>` with the RSVP status. */
export interface LogChange {
  field: string
  from?: string
  to?: string
}

export interface LogEntry {
  /** ISO time it happened. */
  at: string
  accountId: string
  /** Kept on every entry so a removed account's history still says whose it was. */
  email: string
  kind: LogKind
  ok: boolean
  error?: string
  scope?: DeleteScope
  status?: PartStat
  event?: EventSnap
  changes?: LogChange[]
  /** Recurring instances collapsed into this entry. */
  instances?: number
  /** Small extra facts (sync counts, calendar id, reminder mode, …). */
  detail?: Record<string, string | number | boolean>
}

export interface LogQuery {
  accountId?: string
  kinds?: LogKind[]
  /** Only entries strictly older than this ISO time (paging). */
  before?: string
  limit?: number
}

export interface LogPage {
  entries: LogEntry[]
  /** Every account seen in the kept logs, current or removed. */
  accounts: { id: string; email: string }[]
  more: boolean
}
