import type { Attendee, Calendar, CalEvent, PartStat } from '@shared/types'
import type { CalendarProvider, ProviderContext } from '../types'
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

/** PATCH merges nested objects, so the unused field is nulled to allow timed <-> all-day switches. */
const toGTime = (iso: string, allDay: boolean): Record<string, string | null> =>
  allDay ? { date: iso.slice(0, 10), dateTime: null, timeZone: null } : { dateTime: iso, date: null, timeZone: null }

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
      fetch(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      })
    let res = await send(await token())
    if (res.status === 401) res = await send(await refresh())
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
      const g = await api<GEvent>(
        'POST',
        eventPath(calendarId),
        { sendUpdates: attendees.length ? 'all' : 'none' },
        {
          summary: input.title,
          start: toGTime(input.start, input.allDay),
          end: toGTime(input.end, input.allDay),
          location: input.location,
          description: input.description,
          attendees
        }
      )
      return map(g, calendarId)
    },

    async updateEvent(event) {
      const organizer = isOrganizer(event)
      const body: Record<string, unknown> = {
        summary: event.title,
        start: toGTime(event.start, event.allDay),
        end: toGTime(event.end, event.allDay),
        location: event.location ?? null,
        description: event.description ?? null
      }
      // Only the organizer controls the guest list. Existing guests keep Google's fields (incl. their
      // responseStatus, so a stale local copy can't reset replies); new guests are just an email.
      if (organizer) {
        const prev = new Map((rawOf(event)?.attendees ?? []).map((a) => [a.email.toLowerCase(), a]))
        body.attendees = event.attendees.map((a) => prev.get(a.email.toLowerCase()) ?? { email: a.email, displayName: a.name })
      }
      const g = await api<GEvent>('PATCH', eventPath(event.calendarId, event.id), { sendUpdates: organizer ? 'all' : 'none' }, body)
      return map(g, event.calendarId)
    },

    async deleteEvent(event) {
      await api('DELETE', eventPath(event.calendarId, event.id), { sendUpdates: isOrganizer(event) ? 'all' : 'none' })
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
