import { format } from 'date-fns'
import { t, type Locale } from '../i18n'
import type { CalEvent } from '../shared/types'
import { eventBounds } from './layout'
import { eventMeetingUrl, eventPlace, linkKind, linkLabel } from './meeting'

/** Minutes before an event its reminder pops up; 0 turns reminders off. */
export const REMINDER_CHOICES = [0, 1, 2, 5, 10, 15] as const
export const DEFAULT_REMINDER_MIN = 2

export const isReminderMin = (v: unknown): v is number => REMINDER_CHOICES.some((c) => c === v)

/** A reminder that is late by less than this still fires (e.g. a tick right after wake); older ones are dropped. */
export const REMINDER_GRACE_MS = 60_000

/** Identity of one reminder: the start is part of it, so a moved event reminds again. */
export const reminderKey = (e: CalEvent): string => `${e.accountId}/${e.calendarId}/${e.id}@${e.start}`

/** How long a reminded key is remembered past its event start; older ones can never be due again. */
export const REMINDED_KEEP_MS = 60 * 60_000

/** Reminded keys from the stored `{ key: startMs }` object, minus junk and expired ones. */
export function loadReminded(stored: unknown, now: number): Map<string, number> {
  const sent = new Map<string, number>()
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return sent
  for (const [k, start] of Object.entries(stored)) if (typeof start === 'number' && start >= now - REMINDED_KEEP_MS) sent.set(k, start)
  return sent
}

/** Drops expired keys from `sent` in place; true when any went (so the stored copy needs a write). */
export function pruneReminded(sent: Map<string, number>, now: number): boolean {
  const before = sent.size
  for (const [k, start] of sent) if (start < now - REMINDED_KEEP_MS) sent.delete(k)
  return sent.size !== before
}

/** Events whose reminder is due at `now`: timed, not declined, starting within `leadMin` and not reminded yet. */
export function dueReminders(events: CalEvent[], now: Date, leadMin: number, sent: ReadonlySet<string>): CalEvent[] {
  if (leadMin <= 0) return []
  const n = now.getTime()
  return events.filter((e) => {
    if (e.allDay || e.myStatus === 'declined' || sent.has(reminderKey(e))) return false
    const start = eventBounds(e).start.getTime()
    return start - leadMin * 60_000 <= n && n < start + REMINDER_GRACE_MS
  })
}

export interface ReminderText {
  title: string
  body: string
  /** Call link to open from the banner, with its button text. */
  join?: { url: string; label: string }
}

/** Banner text: the title, then "in 2 min · 10:00–10:30 · Room 3", plus the event's call link when it has one. */
export function reminderText(e: CalEvent, now: Date, locale: Locale = 'en'): ReminderText {
  const { start, end } = eventBounds(e)
  const min = Math.ceil((start.getTime() - now.getTime()) / 60_000)
  const when = min > 0 ? t(locale, 'reminder.in', { n: min }) : t(locale, 'reminder.now')
  const body = [when, `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`, eventPlace(e, locale)].filter(Boolean).join(' · ')
  const url = eventMeetingUrl(e)
  const kind = url ? linkKind(url) : undefined
  const label = kind === 'meet' || kind === 'zoom' || kind === 'teams' || kind === 'map' ? linkLabel(url!, kind, locale) : t(locale, 'agenda.joinShort')
  return { title: e.title || t(locale, 'common.untitled'), body, ...(url ? { join: { url, label } } : {}) }
}
