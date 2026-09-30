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
