import { format, isSameDay, parseISO } from 'date-fns'
import { fmt, t, type Key, type Locale } from '../i18n'
import { awaitsReply } from '../logic/details'
import type { CalEvent } from '../shared/types'

export type NoteKind = 'invite' | 'changed' | 'cancelled'
export interface Note {
  kind: NoteKind
  event: CalEvent
}

const at = (iso: string, allDay: boolean): number => (allDay ? parseISO(iso) : new Date(iso)).getTime()
const key = (e: CalEvent): string => `${e.calendarId}/${e.id}`
const WATCHED = ['title', 'start', 'end', 'location'] as const

/** What the user should hear about between two syncs of one account: new invites, moved/renamed and cancelled events. */
export function diffEvents(prev: CalEvent[], next: CalEvent[], now = new Date()): Note[] {
  const live = (e: CalEvent): boolean => at(e.end, e.allDay) > now.getTime() && e.myStatus !== 'declined'
  const before = new Map(prev.map((e) => [key(e), e]))
  const after = new Set(next.map(key))
  const notes: Note[] = []
  for (const e of next) {
    if (!live(e)) continue
    const old = before.get(key(e))
    if (!old) {
      if (awaitsReply(e)) notes.push({ kind: 'invite', event: e })
    } else if (WATCHED.some((f) => (old[f] ?? '') !== (e[f] ?? ''))) notes.push({ kind: 'changed', event: e })
  }
  for (const e of prev) if (live(e) && !after.has(key(e))) notes.push({ kind: 'cancelled', event: e })
  return notes
}

const TITLE: Record<NoteKind, Key> = { invite: 'notify.invite', changed: 'notify.changed', cancelled: 'notify.cancelled' }

/** Banner text: one per note, or a single summary when there are too many to be useful. */
export function noteText(notes: Note[], account: string, now = new Date(), locale: Locale = 'en'): { title: string; body: string }[] {
  if (notes.length > 3) return [{ title: t(locale, 'notify.many', { n: notes.length }), body: account }]
  return notes.map(({ kind, event: e }) => ({
    title: `${t(locale, TITLE[kind])}: ${e.title || t(locale, 'common.untitled')}`,
    body: `${when(e, now, locale)} · ${account}`
  }))
}

function when(e: CalEvent, now: Date, locale: Locale): string {
  const s = e.allDay ? parseISO(e.start) : new Date(e.start)
  if (e.allDay) return `${fmt(locale, s, 'EEE, d MMM')} · ${t(locale, 'when.allDay')}`
  return `${isSameDay(s, now) ? t(locale, 'common.today') : fmt(locale, s, 'EEE, d MMM')} · ${format(s, 'HH:mm')}`
}
