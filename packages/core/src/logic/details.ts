import { addDays, isSameDay, parseISO } from 'date-fns'
import { fmt, t, type Locale } from '../i18n'
import type { Account, Calendar, CalEvent, PartStat } from '../shared/types'

const same = (a?: string, b?: string): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** The account's email when it adds something to its label (Google labels are often the email itself). */
export const extraEmail = (label: string, email?: string): string | undefined => (same(email, label) ? undefined : email)

const SLD = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
/** The label to show: a label that is just the email (Google's default) becomes the mail domain, e.g. "gmail". */
export function accountName(label: string, email?: string): string {
  if (label.trim() && !same(label, email)) return label
  const parts = (email?.split('@')[1] ?? '').trim().toLowerCase().split('.').filter(Boolean)
  if (parts.length > 1) parts.pop()
  if (parts.length > 1 && SLD.has(parts[parts.length - 1])) parts.pop()
  return parts.pop() ?? label
}

/** "<calendar> in <label> · <email>" minus parts repeating an earlier one (Google: label = primary calendar = email). */
export function ownerLine(calendar: string | undefined, label: string, email?: string): { calendar?: string; label: string; email?: string } {
  return { calendar: same(calendar, label) || same(calendar, email) ? undefined : calendar, label, email: extraEmail(label, email) }
}

/** Edit/Delete only for events this account organizes (or plain events) in writable calendars. */
export function canEdit(e: CalEvent, account?: Account, calendar?: Calendar): boolean {
  if (!account || !calendar || calendar.readOnly) return false
  if (e.attendees.length === 0) return true
  return same(e.organizer?.email, account.email) || e.attendees.some((a) => a.self && a.organizer)
}

/** An invite this account still has to answer: never one it organizes itself (its own guest entry may stay unanswered). */
export const awaitsReply = (e: CalEvent): boolean => e.myStatus === 'needsAction' && !e.attendees.some((a) => a.self && a.organizer)

/** Upcoming invites this account still has to answer, soonest first. */
const at = (iso: string, allDay: boolean): number => (allDay ? parseISO(iso) : new Date(iso)).getTime()
export const pendingInvites = (events: CalEvent[], now = new Date()): CalEvent[] =>
  events
    .filter((e) => awaitsReply(e) && at(e.end, e.allDay) > now.getTime())
    .sort((a, b) => at(a.start, a.allDay) - at(b.start, b.allDay))

export function formatWhen(e: CalEvent, locale: Locale = 'en'): string {
  const f = (d: Date, p: string): string => fmt(locale, d, p)
  if (e.allDay) {
    const s = parseISO(e.start)
    const last = addDays(parseISO(e.end), -1)
    const allDay = t(locale, 'when.allDay')
    return last > s ? `${f(s, 'EEE, d MMM')} – ${f(last, 'EEE, d MMM')} · ${allDay}` : `${f(s, 'EEE, d MMM')} · ${allDay}`
  }
  const s = new Date(e.start)
  const end = new Date(e.end)
  return isSameDay(s, end)
    ? `${f(s, 'EEE, d MMM')} · ${f(s, 'HH:mm')} – ${f(end, 'HH:mm')}`
    : `${f(s, 'EEE, d MMM HH:mm')} – ${f(end, 'EEE, d MMM HH:mm')}`
}

export const STATUS_ICON: Record<PartStat, string> = {
  accepted: '✓',
  tentative: '?',
  declined: '✕',
  needsAction: '•'
}

export type TextPart = { text: string; href?: string }

/** Splits text into plain parts and http(s) links; trailing punctuation stays outside the link. */
export function linkify(text: string): TextPart[] {
  const out: TextPart[] = []
  const plain = (t: string): void => {
    if (t) out.push({ text: t })
  }
  let i = 0
  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    const url = m[0].replace(/[.,;:!?)\]}>'"]+$/, '')
    plain(text.slice(i, m.index))
    out.push({ text: url, href: url })
    i = m.index + url.length
  }
  plain(text.slice(i))
  return out
}

/** Description minus `@color:N` / `@colorHex:#RRGGBB` lines other clients store there as metadata. */
export const cleanNotes = (s = ''): string => s.replace(/^@color(hex)?:.*$\n?/gim, '').trim()

const HTML_TAG = /<\/?(a|b|br|p|div|span|i|u|s|em|strong|del|ul|ol|li|h[1-6]|blockquote|pre|code|hr|table|thead|tbody|tr|td|th|font|img|sub|sup)\b[^>]*>/i

/** Google (and some CalDAV clients) store descriptions as HTML fragments; plain notes stay plain. */
export const isHtml = (s: string): boolean => HTML_TAG.test(s)

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
  })

/** HTML description as readable plain text (no DOM): line breaks kept, tags dropped, a link's url kept when its text differs. */
export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<a\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)[^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href: string, inner: string) => {
        const text = inner.replace(/<[^>]*>/g, '').trim()
        const url = decode(href)
        return !text || decode(text) === url ? url : `${text} (${url})`
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|h[1-6]|tr|blockquote|pre|ul|ol)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
