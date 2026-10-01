import type { Attendee, Calendar, CalEvent, DeleteScope, PartStat, Recurrence } from '../../shared/types'
import type { CalendarProvider, ProviderContext } from '../types'
import { fromRRule, toRRule } from '../../logic/recurrence'
import { AuthError, timedFetch } from '../http'
import { getClientConfig, postToken, type GoogleCredentials } from './oauth'

const API = 'https://www.googleapis.com/calendar/v3'

type GAttendee = { email: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean; [k: string]: unknown }
type GTime = { date?: string; dateTime?: string; timeZone?: string }
export interface GEvent {
  id: string
  status?: string
  etag?: string
  summary?: string
  location?: string
  description?: string
  start: GTime
  end: GTime
  organizer?: { email?: string; displayName?: string; self?: boolean }
  attendees?: GAttendee[]
  recurringEventId?: string
  /** Instance only: its slot in the series. */
  originalStartTime?: GTime
  /** Series master only: RRULE/EXDATE/RDATE lines. */
  recurrence?: string[]
}

const STATUSES: PartStat[] = ['accepted', 'declined', 'tentative', 'needsAction']
const toStatus = (s?: string): PartStat => (STATUSES.includes(s as PartStat) ? (s as PartStat) : 'needsAction')

export function mapEvent(g: GEvent, accountId: string, calendarId: string): CalEvent {
  const allDay = !!g.start.date
  const time = (t: GTime): string => (allDay ? t.date! : new Date(t.dateTime!).toISOString())
  const attendees: Attendee[] = (g.attendees ?? []).map((a) => ({
    email: a.email,
    name: a.displayName,
    status: toStatus(a.responseStatus),
    self: a.self || undefined,
    organizer: a.organizer || undefined
  }))
  const self = g.attendees?.find((a) => a.self)
  return {
    id: g.id,
    accountId,
    calendarId,
    title: g.summary ?? '',
    start: time(g.start),
    end: time(g.end),
    allDay,
    location: g.location,
    description: g.description,
    organizer: g.organizer?.email ? { email: g.organizer.email, name: g.organizer.displayName } : undefined,
    attendees,
    myStatus: self ? toStatus(self.responseStatus) : undefined,
    etag: g.etag,
    raw: g,
    recurringEventId: g.recurringEventId
  }
}

/**
 * End a series right before `cutoff` (an instance's originalStartTime): every RRULE gets UNTIL
 * one second (timed) or one day (all-day) earlier, replacing COUNT/UNTIL. Other lines kept.
 * ponytail: RDATEs past the cutoff survive; Google series rarely have them.
 */
export function truncateRecurrence(recurrence: string[], cutoff: GTime): string[] {
  const until = cutoff.date
    ? new Date(Date.parse(cutoff.date) - 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')
    : new Date(Date.parse(cutoff.dateTime!) - 1000).toISOString().replace(/[-:]|\.\d{3}/g, '')
  return recurrence.map((line) => {
    if (!line.startsWith('RRULE:')) return line
    const parts = line.slice(6).split(';').filter((p) => !/^(COUNT|UNTIL)=/i.test(p))
    return `RRULE:${[...parts, `UNTIL=${until}`].join(';')}`
  })
}

const DAY = 86_400_000
const plusDays = (date: string, days: number): string => new Date(Date.parse(date.slice(0, 10)) + days * DAY).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY)
const localDate = (d: Date): string => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-')

/**
 * Where the series' first slot `anchor` goes when one instance moves from `before` to the edited start:
 * by the same offset, so "9:00 -> 10:00" moves every instance (Google expands in the series' time zone).
 * Switching all-day on or off keeps each slot's day offset and takes the edited time of day.
 */
export function shiftAnchor(anchor: GTime, before: GTime, start: string, allDay: boolean, timeZone: string): GTime {
  if (allDay) return { date: plusDays(anchor.date ?? anchor.dateTime!, daysBetween(before.date ?? before.dateTime!, start)) }
  if (anchor.dateTime && before.dateTime) {
    return { dateTime: new Date(Date.parse(anchor.dateTime) + Date.parse(start) - Date.parse(before.dateTime)).toISOString(), timeZone }
  }
  // All-day series becomes timed, in this machine's zone.
  const at = new Date(start)
  const day = new Date(`${plusDays(anchor.date!, daysBetween(before.date!, localDate(at)))}T00:00:00`)
  day.setHours(at.getHours(), at.getMinutes(), at.getSeconds())
  return { dateTime: day.toISOString(), timeZone }
}

/** GTime `from` plus the edited event's duration. */
function endFrom(from: GTime, event: CalEvent, timeZone: string): GTime {
  if (event.allDay) return { date: plusDays(from.date!, daysBetween(event.start, event.end)) }
  return { dateTime: new Date(Date.parse(from.dateTime!) + Date.parse(event.end) - Date.parse(event.start)).toISOString(), timeZone }
}

/** PATCH merges nested objects, so the unused field is nulled to allow timed <-> all-day switches. */
const toGTime = (iso: string, allDay: boolean): Record<string, string | null> =>
  allDay ? { date: iso.slice(0, 10), dateTime: null, timeZone: null } : { dateTime: iso, date: null, timeZone: null }
/** A time for a recurring event, which Google requires to carry a time zone when timed. */
const zoned = (iso: string, allDay: boolean, timeZone: string): GTime => (allDay ? { date: iso.slice(0, 10) } : { dateTime: iso, timeZone })
const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone
const rruleLines = (r: Recurrence, allDay: boolean): string[] => [`RRULE:${toRRule(r, allDay)}`]
const nulled = (t: GTime): Record<string, string | null> => ({ date: null, dateTime: null, timeZone: null, ...t })

export function createGoogleProviderImpl(ctx: ProviderContext): CalendarProvider {
  if (ctx.credentials.kind !== 'google') throw new Error('Google provider needs Google credentials')
  let creds: GoogleCredentials = ctx.credentials
  let refreshing: Promise<string> | undefined

  const refresh = (): Promise<string> =>
    (refreshing ??= (async () => {
      const { clientId, clientSecret } = getClientConfig()
      const tok = await postToken({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: clientId, client_secret: clientSecret })
      creds = { kind: 'google', refreshToken: tok.refreshToken ?? creds.refreshToken, accessToken: tok.accessToken, expiresAt: tok.expiresAt }
      await ctx.saveCredentials(creds)
      return tok.accessToken
    })().finally(() => (refreshing = undefined)))

  const token = async (): Promise<string> =>
    creds.accessToken && (creds.expiresAt ?? 0) > Date.now() + 60_000 ? creds.accessToken : refresh()

  async function api<T>(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
    const qs = new URLSearchParams(query).toString()
    const url = `${API}${path}${qs ? `?${qs}` : ''}`
    const send = async (accessToken: string): Promise<Response> =>
      timedFetch(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      })
    let res = await send(await token())
    if (res.status === 401) res = await send(await refresh())
    if (res.status === 401) throw new AuthError('Google rejected the sign-in; sign in again')
    if (res.status === 204 || (method === 'DELETE' && res.status === 410)) return undefined as T
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(`Google API ${res.status}: ${err.error?.message ?? res.statusText}`)
    }
    return (await res.json()) as T
  }

  const eventPath = (calendarId: string, eventId?: string): string =>
    `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`
  const rawOf = (e: CalEvent): GEvent | undefined => e.raw as GEvent | undefined
  /** No organizer at all means an event on our own calendar that we own. */
  const isOrganizer = (e: CalEvent): boolean => {
    const org = rawOf(e)?.organizer
    if (org?.self !== undefined) return org.self
    return !e.organizer || e.organizer.email.toLowerCase() === ctx.email.toLowerCase()
  }
  const map = (g: GEvent, calendarId: string): CalEvent => mapEvent(g, ctx.accountId, calendarId)

  /** The editable fields of `event` as a Google body. */
  const fields = (event: CalEvent, prevAttendees: GAttendee[] | undefined, organizer: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = { summary: event.title, location: event.location ?? null, description: event.description ?? null }
    // Only the organizer controls the guest list. Existing guests keep Google's fields (incl. their
    // responseStatus, so a stale local copy can't reset replies); new guests are just an email.
    if (organizer) {
      const prev = new Map((prevAttendees ?? []).map((a) => [a.email.toLowerCase(), a]))
      body.attendees = event.attendees.map((a) => prev.get(a.email.toLowerCase()) ?? { email: a.email, displayName: a.name })
    }
    return body
  }

  /**
   * The series' RRULEs for a new series starting at `slot`: COUNT becomes what is left after the
   * instances before `slot` (cancelled ones count too). EXDATE/RDATE lines stay with the old series.
   */
  async function remainingRecurrence(calendarId: string, series: string, recurrence: string[], slot: GTime): Promise<string[]> {
    const rules = recurrence.filter((l) => l.startsWith('RRULE:'))
    if (!rules.some((l) => /;COUNT=|:COUNT=/i.test(l))) return rules
    const cut = Date.parse(slot.dateTime ?? slot.date!)
    let passed = 0
    let pageToken: string | undefined
    do {
      const page = await api<{ items?: GEvent[]; nextPageToken?: string }>('GET', `${eventPath(calendarId, series)}/instances`, {
        showDeleted: 'true',
        timeMax: new Date(cut).toISOString(),
        maxResults: '2500',
        ...(pageToken ? { pageToken } : {})
      })
      for (const g of page.items ?? []) {
        const t = g.originalStartTime ?? g.start
        if (Date.parse(t.dateTime ?? t.date!) < cut) passed++
      }
      pageToken = page.nextPageToken
    } while (pageToken)
    return rules.map((l) => l.replace(/COUNT=(\d+)/i, (_, n: string) => `COUNT=${Math.max(1, Number(n) - passed)}`))
  }

  return {
    async listCalendars(): Promise<Calendar[]> {
      const out: Calendar[] = []
      let pageToken: string | undefined
      do {
        const page = await api<{ items?: Array<{ id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; accessRole?: string }>; nextPageToken?: string }>(
          'GET',
          '/users/me/calendarList',
          pageToken ? { pageToken } : {}
        )
        for (const c of page.items ?? [])
          out.push({
            id: c.id,
            accountId: ctx.accountId,
            name: c.summaryOverride ?? c.summary ?? c.id,
            color: c.backgroundColor ?? '#4285f4',
            readOnly: c.accessRole !== 'owner' && c.accessRole !== 'writer'
          })
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    },

    async listEvents(calendarId, range) {
      const out: CalEvent[] = []
      let pageToken: string | undefined
      do {
        const page = await api<{ items?: GEvent[]; nextPageToken?: string }>('GET', eventPath(calendarId), {
          singleEvents: 'true',
          timeMin: new Date(range.start).toISOString(),
          timeMax: new Date(range.end).toISOString(),
          maxResults: '2500',
          ...(pageToken ? { pageToken } : {})
        })
        for (const g of page.items ?? []) if (g.status !== 'cancelled') out.push(map(g, calendarId))
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    },

    async createEvent(calendarId, input) {
      const attendees = (input.attendees ?? []).map((email) => ({ email }))
      const rule = input.recurrence
      const g = await api<GEvent>(
        'POST',
        eventPath(calendarId),
        { sendUpdates: attendees.length ? 'all' : 'none' },
        {
          summary: input.title,
          start: rule ? zoned(input.start, input.allDay, localZone()) : toGTime(input.start, input.allDay),
          end: rule ? zoned(input.end, input.allDay, localZone()) : toGTime(input.end, input.allDay),
          location: input.location,
          description: input.description,
          attendees,
          ...(rule ? { recurrence: rruleLines(rule, input.allDay) } : {})
        }
      )
      return map(g, calendarId)
    },

    async updateEvent(event, scope: DeleteScope = 'one') {
      const organizer = isOrganizer(event)
      const q = { sendUpdates: organizer ? 'all' : 'none' }
      const series = event.recurringEventId
      const before = rawOf(event)?.start
      if (!series || scope === 'one' || !before) {
        // A single event may start repeating here (the API refuses a rule change for one instance of a series).
        const rule = !series ? event.recurrence : undefined
        const time = (iso: string): Record<string, string | null> => (rule ? nulled(zoned(iso, event.allDay, localZone())) : toGTime(iso, event.allDay))
        const body = {
          ...fields(event, rawOf(event)?.attendees, organizer),
          start: time(event.start),
          end: time(event.end),
          ...(rule ? { recurrence: rruleLines(rule, event.allDay) } : {})
        }
        return map(await api<GEvent>('PATCH', eventPath(event.calendarId, event.id), q, body), event.calendarId)
      }
      const master = await api<GEvent>('GET', eventPath(event.calendarId, series))
      // Recurring events need an explicit zone; keep the series' own.
      const timeZone = master.start.timeZone ?? localZone()
      const rule = event.recurrence
      const slot = rawOf(event)?.originalStartTime ?? before
      const first = master.start.dateTime ?? master.start.date!
      const at = slot.dateTime ?? slot.date!
      // "This and following" from the first instance is the whole series.
      if (scope === 'all' || Date.parse(at) <= Date.parse(first)) {
        // Stop repeating: the series becomes just the edited event.
        const start = rule === null ? zoned(event.start, event.allDay, timeZone) : shiftAnchor(master.start, before, event.start, event.allDay, timeZone)
        const body = {
          ...fields(event, master.attendees, organizer),
          start: nulled(start),
          end: nulled(endFrom(start, event, timeZone)),
          // A new RRULE replaces the old ones; EXDATE/RDATE lines stay.
          ...(rule === undefined ? {} : { recurrence: rule ? [...rruleLines(rule, event.allDay), ...(master.recurrence ?? []).filter((l) => !l.startsWith('RRULE:'))] : [] })
        }
        await api<GEvent>('PATCH', eventPath(event.calendarId, series), q, body)
        return event // its instance id may change with the time; the sync that follows brings the real ones
      }
      // Split: end the old series right before this instance, start a new one from it with the edit.
      const recurrence =
        rule === undefined ? await remainingRecurrence(event.calendarId, series, master.recurrence ?? [], slot) : rule ? rruleLines(rule, event.allDay) : undefined
      await api('PATCH', eventPath(event.calendarId, series), q, { recurrence: truncateRecurrence(master.recurrence ?? [], slot) })
      const start = shiftAnchor(slot, before, event.start, event.allDay, timeZone)
      const created = await api<GEvent>('POST', eventPath(event.calendarId), q, {
        ...fields(event, master.attendees, organizer),
        start,
        end: endFrom(start, event, timeZone),
        ...(recurrence ? { recurrence } : {})
      })
      return { ...map(created, event.calendarId), start: event.start, end: event.end, recurringEventId: recurrence ? created.id : undefined }
    },

    async deleteEvent(event, scope: DeleteScope = 'one') {
      const q = { sendUpdates: isOrganizer(event) ? 'all' : 'none' }
      const series = event.recurringEventId
      if (!series || scope === 'one') return void (await api('DELETE', eventPath(event.calendarId, event.id), q))
      const cutoff = rawOf(event)?.originalStartTime
      if (scope === 'following' && cutoff) {
        const master = await api<GEvent>('GET', eventPath(event.calendarId, series))
        const first = master.start.dateTime ?? master.start.date!
        const at = cutoff.dateTime ?? cutoff.date!
        // Cutting at the first instance leaves nothing: fall through to deleting the series.
        if (Date.parse(at) > Date.parse(first)) {
          const recurrence = truncateRecurrence(master.recurrence ?? [], cutoff)
          return void (await api('PATCH', eventPath(event.calendarId, series), q, { recurrence }))
        }
      }
      await api('DELETE', eventPath(event.calendarId, series), q)
    },

    async getRecurrence(event) {
      if (!event.recurringEventId) return null
      const master = await api<GEvent>('GET', eventPath(event.calendarId, event.recurringEventId))
      const line = master.recurrence?.find((l) => l.startsWith('RRULE:'))
      return line ? fromRRule(line, master.start.dateTime ?? master.start.date) : null
    },

    async respond(event, status) {
      const attendees: GAttendee[] =
        rawOf(event)?.attendees ??
        event.attendees.map((a) => ({ email: a.email, displayName: a.name, responseStatus: a.status, self: a.self, organizer: a.organizer }))
      if (!attendees.some((a) => a.self)) throw new Error('This account is not an attendee of the event')
      const g = await api<GEvent>(
        'PATCH',
        eventPath(event.calendarId, event.id),
        { sendUpdates: 'all' },
        { attendees: attendees.map((a) => (a.self ? { ...a, responseStatus: status } : a)) }
      )
      return map(g, event.calendarId)
    }
  }
}
