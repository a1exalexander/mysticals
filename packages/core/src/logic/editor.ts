import { addDays, addHours, format, parseISO, startOfHour } from 'date-fns'
import type { Account, Attendee, Calendar, CalEvent, NewEventInput, Recurrence } from '../shared/types'
import { t, type Locale } from '../i18n'
import { sameRecurrence } from './recurrence'

/** Form state. start/end are always 'YYYY-MM-DDTHH:mm' (local); all-day uses the date part, end inclusive. */
export interface EventForm {
  accountId: string
  calendarId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location: string
  description: string
  attendees: string[]
  /** How it repeats; null = does not repeat. */
  repeat: Recurrence | null
  /** The rule when the editor opened; undefined while a series' rule is still loading (or failed to load). */
  repeatWas: Recurrence | null | undefined
}

const LOCAL = "yyyy-MM-dd'T'HH:mm"

/** ISO instant or 'YYYY-MM-DD' -> datetime-local value. */
export const toLocalInput = (iso: string): string =>
  format(iso.length === 10 ? parseISO(iso) : new Date(iso), LOCAL)

/** datetime-local value -> ISO instant (parsed as local time). */
export const fromLocalInput = (local: string): string => new Date(local).toISOString()

export const writableCalendars = (calendars: Calendar[], accountId: string): Calendar[] =>
  calendars.filter((c) => c.accountId === accountId && !c.readOnly)

/** Accounts that can hold a new event. */
export const writableAccounts = (accounts: Account[], calendars: Calendar[]): Account[] =>
  accounts.filter((a) => writableCalendars(calendars, a.id).length > 0)

/** Only a single-option choice is preselected; otherwise the user must pick. Never a global default. */
export const soleId = <T extends { id: string }>(items: T[]): string => (items.length === 1 ? items[0].id : '')

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
export const splitEmails = (text: string): string[] =>
  text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
export const isEmail = (s: string): boolean => EMAIL.test(s)

export function emptyForm(
  accounts: Account[],
  calendars: Calendar[],
  prefill: { start?: string; end?: string; allDay?: boolean } = {},
  now = new Date()
): EventForm {
  const accountId = soleId(writableAccounts(accounts, calendars))
  const start = prefill.start ? toLocalInput(prefill.start) : format(startOfHour(addHours(now, 1)), LOCAL)
  let end = prefill.end ? toLocalInput(prefill.end) : format(addHours(new Date(start), 1), LOCAL)
  // All-day prefill arrives with an exclusive end date; the form shows it inclusive.
  if (prefill.allDay && prefill.end) end = inclusiveEnd(start, end)
  return {
    accountId,
    calendarId: accountId ? soleId(writableCalendars(calendars, accountId)) : '',
    title: '',
    start,
    end,
    allDay: !!prefill.allDay,
    location: '',
    description: '',
    attendees: [],
    repeat: null,
    repeatWas: null
  }
}

const inclusiveEnd = (startLocal: string, endLocal: string): string => {
  const d = format(addDays(new Date(endLocal), -1), LOCAL)
  return d.slice(0, 10) < startLocal.slice(0, 10) ? startLocal : d
}

export function formFromEvent(e: CalEvent): EventForm {
  const start = toLocalInput(e.start)
  const endLocal = toLocalInput(e.end)
  return {
    accountId: e.accountId,
    calendarId: e.calendarId,
    title: e.title,
    start,
    end: e.allDay ? inclusiveEnd(start, endLocal) : endLocal,
    allDay: e.allDay,
    location: e.location ?? '',
    description: e.description ?? '',
    attendees: e.attendees.filter((a) => !a.self && !a.organizer).map((a) => a.email),
    repeat: null,
    // A series' rule isn't cached: the editor loads it (events.recurrence) and sets both fields.
    repeatWas: e.recurringEventId ? undefined : null
  }
}

/** The form with the loaded series rule as both the current and the original value. */
export const withLoadedRepeat = (f: EventForm, rule: Recurrence | null): EventForm => ({ ...f, repeat: rule, repeatWas: rule })

/** Whether the user changed how the event repeats. */
export const repeatChanged = (f: EventForm): boolean => f.repeatWas !== undefined && !sameRecurrence(f.repeat, f.repeatWas, f.start)

/** Toggle all-day; a timed event gets at least a 1h span so it stays savable. */
export function setAllDay(f: EventForm, allDay: boolean): EventForm {
  if (allDay || f.end > f.start) return { ...f, allDay }
  return { ...f, allDay, end: format(addHours(new Date(f.start), 1), LOCAL) }
}

/** Move the start; the end follows so the duration is kept. */
export function moveStart(f: EventForm, start: string): EventForm {
  const end = new Date(new Date(f.end).getTime() + new Date(start).getTime() - new Date(f.start).getTime())
  return { ...f, start, end: format(end, LOCAL) }
}

type Times = Pick<NewEventInput, 'start' | 'end' | 'allDay'>

function times(f: EventForm, locale: Locale): Times {
  if (f.allDay) {
    const start = f.start.slice(0, 10)
    const endIncl = f.end.slice(0, 10)
    if (endIncl < start) throw new Error(t(locale, 'form.endBeforeStartDate'))
    return { allDay: true, start, end: format(addDays(parseISO(endIncl), 1), 'yyyy-MM-dd') }
  }
  const start = fromLocalInput(f.start)
  const end = fromLocalInput(f.end)
  if (end <= start) throw new Error(t(locale, 'form.endAfterStart'))
  return { allDay: false, start, end }
}

function checkEmails(list: string[], locale: Locale): string[] {
  const bad = list.filter((e) => !isEmail(e))
  if (bad.length) throw new Error(t(locale, 'form.invalidEmail', { list: bad.join(', ') }))
  return [...new Set(list.map((e) => e.toLowerCase()))]
}

/** Throws a user-facing Error when the form is not valid. */
export function formToInput(f: EventForm, locale: Locale = 'en'): NewEventInput {
  if (!f.accountId) throw new Error(t(locale, 'form.chooseAccount'))
  if (!f.calendarId) throw new Error(t(locale, 'form.chooseCalendar'))
  const attendees = checkEmails(f.attendees, locale)
  return {
    accountId: f.accountId,
    calendarId: f.calendarId,
    title: f.title.trim() || t(locale, 'common.newEvent'),
    ...times(f, locale),
    location: f.location.trim() || undefined,
    description: f.description.trim() || undefined,
    ...(attendees.length ? { attendees } : {}),
    ...(f.repeat ? { recurrence: f.repeat } : {})
  }
}

/** Apply edits to an existing event. Account and calendar never change. */
export function applyForm(e: CalEvent, f: EventForm, locale: Locale = 'en'): CalEvent {
  const emails = checkEmails(f.attendees, locale)
  const keep = e.attendees.filter((a) => a.self || a.organizer)
  const byEmail = new Map(e.attendees.map((a) => [a.email.toLowerCase(), a]))
  const invited: Attendee[] = emails
    .filter((m) => !keep.some((a) => a.email.toLowerCase() === m))
    .map((m) => byEmail.get(m) ?? { email: m, status: 'needsAction' })
  return {
    ...e,
    title: f.title.trim() || t(locale, 'common.newEvent'),
    ...times(f, locale),
    location: f.location.trim() || undefined,
    description: f.description.trim() || undefined,
    attendees: [...keep, ...invited],
    // Only a changed rule is sent; absent keeps the series' rule.
    ...(repeatChanged(f) ? { recurrence: f.repeat } : {})
  }
}

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix. */
export const errorText = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
