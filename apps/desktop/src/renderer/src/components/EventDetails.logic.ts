import { addDays, format, isSameDay, parseISO } from 'date-fns'
import type { Account, Calendar, CalEvent, PartStat } from '@shared/types'

const same = (a?: string, b?: string): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** "<calendar> in <label> · <email>" minus parts repeating an earlier one (Google: label = primary calendar = email). */
export function ownerLine(calendar: string | undefined, label: string, email?: string): { calendar?: string; label: string; email?: string } {
  return { calendar: same(calendar, label) || same(calendar, email) ? undefined : calendar, label, email: same(email, label) ? undefined : email }
}

/** Edit/Delete only for events this account organizes (or plain events) in writable calendars. */
export function canEdit(e: CalEvent, account?: Account, calendar?: Calendar): boolean {
  if (!account || !calendar || calendar.readOnly) return false
  if (e.attendees.length === 0) return true
  return same(e.organizer?.email, account.email) || e.attendees.some((a) => a.self && a.organizer)
}

/** Upcoming invites this account still has to answer, soonest first. */
const at = (iso: string, allDay: boolean): number => (allDay ? parseISO(iso) : new Date(iso)).getTime()
export const pendingInvites = (events: CalEvent[], now = new Date()): CalEvent[] =>
  events
    .filter((e) => e.myStatus === 'needsAction' && at(e.end, e.allDay) > now.getTime())
    .sort((a, b) => at(a.start, a.allDay) - at(b.start, b.allDay))

export function formatWhen(e: CalEvent): string {
  if (e.allDay) {
    const s = parseISO(e.start)
    const last = addDays(parseISO(e.end), -1)
    return last > s ? `${format(s, 'EEE, d MMM')} – ${format(last, 'EEE, d MMM')} · all day` : `${format(s, 'EEE, d MMM')} · all day`
  }
  const s = new Date(e.start)
  const t = new Date(e.end)
  return isSameDay(s, t)
    ? `${format(s, 'EEE, d MMM')} · ${format(s, 'HH:mm')} – ${format(t, 'HH:mm')}`
    : `${format(s, 'EEE, d MMM HH:mm')} – ${format(t, 'EEE, d MMM HH:mm')}`
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
