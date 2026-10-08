import { addMonths, subMonths } from 'date-fns'
import type { AccountCache } from '../accounts/store'
import type { CalEvent, EventSnap, LogChange, LogEntry } from '../shared/types'

const MAX = 2000
const cut = (s?: string): string | undefined => (s && s.length > MAX ? `${s.slice(0, MAX)}…` : s)

/** The event as the activity log keeps it: no provider payload, long texts cut. */
export function snap(e: CalEvent): EventSnap {
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    location: cut(e.location),
    conferenceUrl: e.conferenceUrl,
    description: cut(e.description),
    organizer: e.organizer,
    attendees: e.attendees.map(({ email, name, status, self, organizer }) => ({ email, name, status, self, organizer })),
    myStatus: e.myStatus,
    recurringEventId: e.recurringEventId,
    ...(e.recurrence !== undefined ? { recurrence: e.recurrence } : {})
  }
}

type Comparable = Pick<CalEvent, 'title' | 'start' | 'end' | 'allDay' | 'attendees'> & Partial<CalEvent>
const FIELDS = ['title', 'start', 'end', 'allDay', 'calendarId', 'location', 'conferenceUrl', 'description', 'myStatus'] as const
const str = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : typeof v === 'string' ? cut(v) : JSON.stringify(v))
const low = (s: string): string => s.trim().toLowerCase()

/** What differs between two versions of an event, field by field; attendees by email with their RSVP status. */
export function fieldChanges(a: Comparable, b: Comparable): LogChange[] {
  const out: LogChange[] = []
  const push = (field: string, x: unknown, y: unknown): void => {
    const from = str(x)
    const to = str(y)
    if (from !== to) out.push({ field, from, to })
  }
  for (const f of FIELDS) push(f, a[f], b[f])
  push('organizer', a.organizer?.email, b.organizer?.email)
  if (a.recurrence !== undefined || b.recurrence !== undefined) push('recurrence', a.recurrence, b.recurrence)
  const before = new Map(a.attendees.map((x) => [low(x.email), x.status]))
  const after = new Map(b.attendees.map((x) => [low(x.email), x.status]))
  for (const email of new Set([...before.keys(), ...after.keys()])) push(`attendee:${email}`, before.get(email), after.get(email))
  return out
}

export type RemoteChange = Pick<LogEntry, 'kind' | 'event' | 'changes' | 'instances'>

const key = (e: CalEvent): string => `${e.calendarId}/${e.id}`

/**
 * Everything a sync brought from the server between two caches of one account: added, changed (with field diff) and
 * removed events. Events that only slid in or out of the synced window (now ± 3 months) are not changes. Instances of
 * one recurring series with the same kind of change collapse into one entry.
 */
export function remoteChanges(prev: AccountCache, next: AccountCache): RemoteChange[] {
  const now = next.syncedAt ? new Date(next.syncedAt) : new Date()
  const windowStart = subMonths(now, 3).getTime()
  const prevEnd = addMonths(prev.syncedAt ? new Date(prev.syncedAt) : now, 3).getTime()
  const before = new Map(prev.events.map((e) => [key(e), e]))
  const after = new Set(next.events.map(key))
  const groups = new Map<string, RemoteChange>()
  const add = (group: string, c: RemoteChange): void => {
    const g = groups.get(group)
    if (g) g.instances = (g.instances ?? 1) + 1
    else groups.set(group, c)
  }
  const series = (e: CalEvent): string => `${e.calendarId}/${e.recurringEventId ?? e.id}`
  for (const e of next.events) {
    const old = before.get(key(e))
    if (!old) {
      if (Date.parse(e.start) >= prevEnd) continue
      add(`add|${series(e)}`, { kind: 'remote.add', event: snap(e) })
      continue
    }
    const changes = fieldChanges(old, e)
    if (!changes.length) continue
    // Instances of a series moved together differ in times but share which fields changed.
    add(`change|${series(e)}|${changes.map((c) => c.field).join(',')}`, { kind: 'remote.change', event: snap(e), changes })
  }
  for (const e of prev.events) {
    if (after.has(key(e)) || Date.parse(e.end) < windowStart) continue
    add(`remove|${series(e)}`, { kind: 'remote.remove', event: snap(e) })
  }
  return [...groups.values()]
}
