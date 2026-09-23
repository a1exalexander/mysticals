import { format, isSameDay, parseISO } from 'date-fns'
import type { CalEvent } from '@shared/types'

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
      if (e.myStatus === 'needsAction') notes.push({ kind: 'invite', event: e })
    } else if (WATCHED.some((f) => (old[f] ?? '') !== (e[f] ?? ''))) notes.push({ kind: 'changed', event: e })
  }
  for (const e of prev) if (live(e) && !after.has(key(e))) notes.push({ kind: 'cancelled', event: e })
  return notes
}

const TITLE: Record<NoteKind, string> = { invite: 'New invite', changed: 'Event changed', cancelled: 'Event cancelled' }

/** Banner text: one per note, or a single summary when there are too many to be useful. */
export function noteText(notes: Note[], account: string, now = new Date()): { title: string; body: string }[] {
  if (notes.length > 3) return [{ title: `${notes.length} calendar updates`, body: account }]
  return notes.map(({ kind, event: e }) => ({ title: `${TITLE[kind]}: ${e.title || 'Untitled'}`, body: `${when(e, now)} · ${account}` }))
}

function when(e: CalEvent, now: Date): string {
  const s = e.allDay ? parseISO(e.start) : new Date(e.start)
  if (e.allDay) return `${format(s, 'EEE, d MMM')} · all day`
  return `${isSameDay(s, now) ? 'Today' : format(s, 'EEE, d MMM')} · ${format(s, 'HH:mm')}`
}
