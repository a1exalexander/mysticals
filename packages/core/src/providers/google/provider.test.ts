import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credentials } from '../../shared/types'
import { createGoogleProviderImpl, mapEvent, shiftAnchor, truncateRecurrence, type GEvent } from './provider'
import { setClientConfig } from './oauth'
import { http } from '../http'

type Call = { method: string; url: URL; body?: any }
let calls: Call[]
let respond: (c: Call) => Response

beforeEach(() => {
  calls = []
  setClientConfig({ clientId: 'cid', clientSecret: 'secret' })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const c: Call = {
      method: init.method ?? 'GET',
      url: new URL(url),
      body: typeof init.body === 'string' ? (init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : undefined
    }
    calls.push(c)
    return respond(c)
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const saved: Credentials[] = []
const provider = (creds: Partial<Extract<Credentials, { kind: 'google' }>> = {}) =>
  createGoogleProviderImpl({
    accountId: 'acc1',
    email: 'me@gmail.com',
    credentials: { kind: 'google', refreshToken: 'rt', accessToken: 'at', expiresAt: Date.now() + 3600_000, ...creds },
    saveCredentials: async (c) => void saved.push(c)
  })

const invite: GEvent = {
  id: 'ev1',
  etag: '"e1"',
  summary: 'Daily',
  start: { dateTime: '2026-09-23T10:00:00+03:00' },
  end: { dateTime: '2026-09-23T10:30:00+03:00' },
  organizer: { email: 'boss@work.com', displayName: 'Boss' },
  attendees: [
    { email: 'boss@work.com', organizer: true, responseStatus: 'accepted' },
    { email: 'me@gmail.com', self: true, responseStatus: 'needsAction', comment: 'keep me' },
    { email: 'other@work.com', responseStatus: 'tentative' }
  ],
  recurringEventId: 'series1'
}
const own: GEvent = { id: 'ev2', summary: 'Mine', start: { date: '2026-09-23' }, end: { date: '2026-09-24' }, organizer: { email: 'me@gmail.com', self: true } }

describe('mapEvent', () => {
  it('maps a timed invite', () => {
    const e = mapEvent(invite, 'acc1', 'primary')
    expect(e).toMatchObject({
      id: 'ev1',
      accountId: 'acc1',
      calendarId: 'primary',
      title: 'Daily',
      start: '2026-09-23T07:00:00.000Z',
      end: '2026-09-23T07:30:00.000Z',
      allDay: false,
      organizer: { email: 'boss@work.com', name: 'Boss' },
      myStatus: 'needsAction',
      etag: '"e1"',
      recurringEventId: 'series1',
      raw: invite
    })
    expect(e.attendees[1]).toMatchObject({ email: 'me@gmail.com', self: true, status: 'needsAction' })
    expect(e.attendees[0].organizer).toBe(true)
  })

  it('maps an all-day event with dates', () => {
    const e = mapEvent(own, 'acc1', 'primary')
    expect(e).toMatchObject({ allDay: true, start: '2026-09-23', end: '2026-09-24', attendees: [] })
    expect(e.myStatus).toBeUndefined()
  })
})

describe('provider', () => {
  it('lists calendars with readOnly from accessRole', async () => {
    respond = () =>
      Response.json({
        items: [
          { id: 'primary', summary: 'Me', backgroundColor: '#f00', accessRole: 'owner' },
          { id: 'hol', summary: 'Holidays', backgroundColor: '#0f0', accessRole: 'reader' }
        ]
      })
    const cals = await provider().listCalendars()
    expect(cals).toEqual([
      { id: 'primary', accountId: 'acc1', name: 'Me', color: '#f00', readOnly: false },
      { id: 'hol', accountId: 'acc1', name: 'Holidays', color: '#0f0', readOnly: true }
    ])
  })

  it('lists events with pagination, singleEvents and skips cancelled', async () => {
    respond = (c) =>
      c.url.searchParams.get('pageToken')
        ? Response.json({ items: [own] })
        : Response.json({ items: [invite, { ...own, id: 'x', status: 'cancelled' }], nextPageToken: 'p2' })
    const evs = await provider().listEvents('primary', { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' })
    expect(evs.map((e) => e.id)).toEqual(['ev1', 'ev2'])
    const q = calls[0].url.searchParams
    expect(q.get('singleEvents')).toBe('true')
    expect(q.get('maxResults')).toBe('2500')
    expect(q.get('timeMin')).toBe('2026-09-01T00:00:00.000Z')
  })

  it('create: sendUpdates=none without attendees, all with attendees; no auto attendees', async () => {
    respond = (c) => Response.json({ ...own, attendees: c.body.attendees })
    const p = provider()
    const base = { accountId: 'acc1', calendarId: 'primary', title: 'T', start: '2026-09-23', end: '2026-09-24', allDay: true }
    await p.createEvent('primary', base)
    expect(calls[0].url.searchParams.get('sendUpdates')).toBe('none')
    expect(calls[0].body.attendees).toEqual([])
    expect(calls[0].body.start).toEqual({ date: '2026-09-23', dateTime: null, timeZone: null })
    await p.createEvent('primary', { ...base, attendees: ['a@x.com'] })
    expect(calls[1].url.searchParams.get('sendUpdates')).toBe('all')
    expect(calls[1].body.attendees).toEqual([{ email: 'a@x.com' }])
  })

  it('update: sendUpdates=all only when organizer; non-organizer does not touch attendees', async () => {
    respond = () => Response.json(invite)
    const p = provider()
    await p.updateEvent(mapEvent(invite, 'acc1', 'primary'))
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].url.searchParams.get('sendUpdates')).toBe('none')
    expect(calls[0].body.attendees).toBeUndefined()
    await p.updateEvent({ ...mapEvent(own, 'acc1', 'primary'), title: 'Renamed' })
    expect(calls[1].url.searchParams.get('sendUpdates')).toBe('all')
    expect(calls[1].body.summary).toBe('Renamed')
  })

  it('update by organizer keeps existing guests replies and adds new guests by email only', async () => {
    respond = () => Response.json(invite)
    const g: GEvent = { ...invite, organizer: { email: 'me@gmail.com', self: true } }
    const e = mapEvent(g, 'acc1', 'primary')
    e.attendees = [{ ...e.attendees[2], status: 'needsAction' }, { email: 'new@x.com', status: 'needsAction' }]
    await provider().updateEvent(e)
    expect(calls[0].body.attendees).toEqual([invite.attendees![2], { email: 'new@x.com' }])
  })

  it('delete: non-organizer uses sendUpdates=none', async () => {
    respond = () => new Response(null, { status: 204 })
    const p = provider()
    await p.deleteEvent(mapEvent(invite, 'acc1', 'primary'))
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].url.searchParams.get('sendUpdates')).toBe('none')
    await p.deleteEvent(mapEvent(own, 'acc1', 'primary'))
    expect(calls[1].url.searchParams.get('sendUpdates')).toBe('all')
  })

  it('delete all: deletes the series master', async () => {
    respond = () => new Response(null, { status: 204 })
    await provider().deleteEvent(mapEvent(invite, 'acc1', 'primary'), 'all')
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].url.pathname).toBe('/calendar/v3/calendars/primary/events/series1')
  })

  it('delete following: truncates the master RRULE before the instance', async () => {
    const master: GEvent = { id: 'series1', start: { dateTime: '2026-09-01T10:00:00Z' }, end: { dateTime: '2026-09-01T11:00:00Z' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=90'] }
    respond = () => Response.json(master)
    const inst = mapEvent({ ...invite, originalStartTime: { dateTime: '2026-09-23T10:00:00Z' } }, 'acc1', 'primary')
    await provider().deleteEvent(inst, 'following')
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(calls[1].url.pathname).toBe('/calendar/v3/calendars/primary/events/series1')
    expect(calls[1].body).toEqual({ recurrence: ['RRULE:FREQ=DAILY;UNTIL=20260923T095959Z'] })
  })

  it('delete following from the first instance deletes the series', async () => {
    const master: GEvent = { id: 'series1', start: { dateTime: '2026-09-23T10:00:00Z' }, end: { dateTime: '2026-09-23T11:00:00Z' }, recurrence: ['RRULE:FREQ=DAILY'] }
    respond = (c) => (c.method === 'GET' ? Response.json(master) : new Response(null, { status: 204 }))
    await provider().deleteEvent(mapEvent({ ...invite, originalStartTime: { dateTime: '2026-09-23T10:00:00Z' } }, 'acc1', 'primary'), 'following')
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE'])
    expect(calls[1].url.pathname).toBe('/calendar/v3/calendars/primary/events/series1')
  })

  describe('recurring edit scopes', () => {
    const master: GEvent = {
      id: 'series1',
      summary: 'Daily',
      start: { dateTime: '2026-09-01T10:00:00+03:00', timeZone: 'Europe/Kyiv' },
      end: { dateTime: '2026-09-01T10:30:00+03:00', timeZone: 'Europe/Kyiv' },
      organizer: { email: 'me@gmail.com', self: true },
      recurrence: ['RRULE:FREQ=DAILY;COUNT=30', 'EXDATE;TZID=Europe/Kyiv:20260905T100000']
    }
    const inst = mapEvent({ ...invite, id: 'series1_20260923T070000Z', organizer: { email: 'me@gmail.com', self: true }, originalStartTime: invite.start }, 'acc1', 'primary')

    it('all: patches the master with the fields and the same time offset', async () => {
      respond = (c) => Response.json(c.method === 'GET' ? master : { ...master, summary: c.body.summary })
      const out = await provider().updateEvent({ ...inst, title: 'Sync', start: '2026-09-23T08:00:00.000Z', end: '2026-09-23T09:00:00.000Z' }, 'all')
      expect(calls.map((c) => [c.method, c.url.pathname])).toEqual([
        ['GET', '/calendar/v3/calendars/primary/events/series1'],
        ['PATCH', '/calendar/v3/calendars/primary/events/series1']
      ])
      expect(calls[1].url.searchParams.get('sendUpdates')).toBe('all')
      expect(calls[1].body).toMatchObject({
        summary: 'Sync',
        start: { dateTime: '2026-09-01T08:00:00.000Z', timeZone: 'Europe/Kyiv', date: null },
        end: { dateTime: '2026-09-01T09:00:00.000Z', timeZone: 'Europe/Kyiv', date: null }
      })
      expect(calls[1].body.recurrence).toBeUndefined()
      expect(out.title).toBe('Sync')
    })

    it('following: ends the series before the instance and creates the rest with the edit', async () => {
      respond = (c) => {
        if (c.method === 'GET' && c.url.pathname.endsWith('/instances'))
          return Response.json({ items: Array.from({ length: 22 }, (_, i) => ({ ...invite, originalStartTime: { dateTime: `2026-09-${String(i + 1).padStart(2, '0')}T07:00:00Z` } })) })
        if (c.method === 'GET') return Response.json(master)
        if (c.method === 'POST') return Response.json({ ...c.body, id: 'series2' })
        return Response.json(master)
      }
      const out = await provider().updateEvent({ ...inst, title: 'Sync' }, 'following')
      expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'PATCH', 'POST'])
      expect(calls[1].url.searchParams.get('timeMax')).toBe('2026-09-23T07:00:00.000Z')
      expect(calls[1].url.searchParams.get('showDeleted')).toBe('true')
      expect(calls[2].body).toEqual({ recurrence: ['RRULE:FREQ=DAILY;UNTIL=20260923T065959Z', 'EXDATE;TZID=Europe/Kyiv:20260905T100000'] })
      expect(calls[3].url.pathname).toBe('/calendar/v3/calendars/primary/events')
      expect(calls[3].body).toMatchObject({
        summary: 'Sync',
        start: { dateTime: '2026-09-23T07:00:00.000Z', timeZone: 'Europe/Kyiv' },
        end: { dateTime: '2026-09-23T07:30:00.000Z', timeZone: 'Europe/Kyiv' },
        recurrence: ['RRULE:FREQ=DAILY;COUNT=8']
      })
      expect(out).toMatchObject({ id: 'series2', recurringEventId: 'series2', title: 'Sync', start: inst.start })
    })

    it('following from the first instance edits the whole series', async () => {
      respond = () => Response.json({ ...master, start: invite.start, end: invite.end })
      await provider().updateEvent({ ...inst, title: 'Sync' }, 'following')
      expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
      expect(calls[1].url.pathname).toBe('/calendar/v3/calendars/primary/events/series1')
    })
  })

  describe('repeat rules', () => {
    const master: GEvent = {
      id: 'series1',
      start: { dateTime: '2026-09-01T10:00:00+03:00', timeZone: 'Europe/Kyiv' },
      end: { dateTime: '2026-09-01T10:30:00+03:00', timeZone: 'Europe/Kyiv' },
      organizer: { email: 'me@gmail.com', self: true },
      recurrence: ['RRULE:FREQ=DAILY;COUNT=30', 'EXDATE;TZID=Europe/Kyiv:20260905T100000']
    }
    const inst = mapEvent({ ...invite, id: 'series1_20260923T070000Z', organizer: { email: 'me@gmail.com', self: true }, originalStartTime: invite.start }, 'acc1', 'primary')

    it('reads the series rule; a single event has none', async () => {
      respond = () => Response.json(master)
      expect(await provider().getRecurrence(inst)).toEqual({ freq: 'daily', count: 30 })
      expect(await provider().getRecurrence(mapEvent(own, 'acc1', 'primary'))).toBeNull()
      expect(calls).toHaveLength(1)
    })

    it('creates a repeating event with a time zone', async () => {
      respond = (c) => Response.json({ ...c.body, id: 'n1' })
      await provider().createEvent('primary', { accountId: 'acc1', calendarId: 'primary', title: 'Gym', start: '2026-09-23T16:00:00.000Z', end: '2026-09-23T17:00:00.000Z', allDay: false, recurrence: { freq: 'weekly', count: 4 } })
      expect(calls[0].body).toMatchObject({ recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'], start: { dateTime: '2026-09-23T16:00:00.000Z', timeZone: expect.any(String) } })
    })

    it('makes a single event repeat', async () => {
      respond = () => Response.json(own)
      await provider().updateEvent({ ...mapEvent(own, 'acc1', 'primary'), recurrence: { freq: 'yearly' } })
      expect(calls[0].method).toBe('PATCH')
      expect(calls[0].body).toMatchObject({ recurrence: ['RRULE:FREQ=YEARLY'], start: { date: '2026-09-23', dateTime: null } })
    })

    it('all: a new rule replaces the RRULE and keeps EXDATEs', async () => {
      respond = () => Response.json(master)
      await provider().updateEvent({ ...inst, recurrence: { freq: 'weekly', interval: 2 } }, 'all')
      expect(calls[1].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2', 'EXDATE;TZID=Europe/Kyiv:20260905T100000'])
      expect(calls[1].body.start).toMatchObject({ dateTime: '2026-09-01T07:00:00.000Z', timeZone: 'Europe/Kyiv' })
    })

    it('all: stop repeating leaves just this event, at its own time', async () => {
      respond = () => Response.json(master)
      await provider().updateEvent({ ...inst, recurrence: null }, 'all')
      expect(calls[1].body).toMatchObject({ recurrence: [], start: { dateTime: inst.start, timeZone: 'Europe/Kyiv' } })
    })

    it('following: the new series takes the new rule, or none', async () => {
      respond = (c) => (c.method === 'POST' ? Response.json({ ...c.body, id: 'series2' }) : Response.json(master))
      const weekly = await provider().updateEvent({ ...inst, recurrence: { freq: 'weekly' } }, 'following')
      expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH', 'POST'])
      expect(calls[2].body.recurrence).toEqual(['RRULE:FREQ=WEEKLY'])
      expect(weekly.recurringEventId).toBe('series2')
      calls.length = 0
      const single = await provider().updateEvent({ ...inst, recurrence: null }, 'following')
      expect(calls[2].body.recurrence).toBeUndefined()
      expect(single.recurringEventId).toBeUndefined()
    })
  })

  describe('shiftAnchor', () => {
    it('moves all-day series by days and switches between timed and all-day', () => {
      expect(shiftAnchor({ date: '2026-09-01' }, { date: '2026-09-10' }, '2026-09-12', true, 'UTC')).toEqual({ date: '2026-09-03' })
      expect(shiftAnchor({ dateTime: '2026-09-01T10:00:00+03:00' }, { dateTime: '2026-09-10T10:00:00+03:00' }, '2026-09-11', true, 'UTC')).toEqual({ date: '2026-09-02' })
    })
  })

  it('respond: changes only the self attendee and notifies organizer', async () => {
    respond = (c) => Response.json({ ...invite, attendees: c.body.attendees })
    const e = await provider().respond(mapEvent(invite, 'acc1', 'primary'), 'accepted')
    const c = calls[0]
    expect(c.method).toBe('PATCH')
    expect(c.url.pathname).toBe('/calendar/v3/calendars/primary/events/ev1')
    expect(c.url.searchParams.get('sendUpdates')).toBe('all')
    expect(Object.keys(c.body)).toEqual(['attendees'])
    expect(c.body.attendees).toEqual([invite.attendees![0], { ...invite.attendees![1], responseStatus: 'accepted' }, invite.attendees![2]])
    expect(e.myStatus).toBe('accepted')
  })

  it('respond: throws without a self attendee', async () => {
    respond = () => Response.json({})
    await expect(provider().respond(mapEvent(own, 'acc1', 'primary'), 'accepted')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('refreshes on 401, retries once and saves only its own credentials', async () => {
    saved.length = 0
    respond = (c) => {
      if (c.url.host === 'oauth2.googleapis.com') return Response.json({ access_token: 'new', expires_in: 3600 })
      return calls.filter((x) => x.url.host !== 'oauth2.googleapis.com').length === 1
        ? new Response('{}', { status: 401 })
        : Response.json({ items: [] })
    }
    await provider().listCalendars()
    expect(calls.map((c) => c.url.host)).toEqual(['www.googleapis.com', 'oauth2.googleapis.com', 'www.googleapis.com'])
    const refreshBody = new URLSearchParams(calls[1].body)
    expect(refreshBody.get('grant_type')).toBe('refresh_token')
    expect(refreshBody.get('refresh_token')).toBe('rt')
    expect(saved).toEqual([{ kind: 'google', refreshToken: 'rt', accessToken: 'new', expiresAt: expect.any(Number) }])
  })

  it('refreshes an expired access token before calling the API', async () => {
    respond = (c) => (c.url.host === 'oauth2.googleapis.com' ? Response.json({ access_token: 'new', expires_in: 3600 }) : Response.json({ items: [] }))
    await provider({ expiresAt: Date.now() - 1 }).listCalendars()
    expect(calls.map((c) => c.url.host)).toEqual(['oauth2.googleapis.com', 'www.googleapis.com'])
  })
})

describe('truncateRecurrence', () => {
  it('sets UNTIL one second before a timed cutoff, replacing COUNT/UNTIL, keeping other lines', () => {
    expect(truncateRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20300101T000000Z', 'EXDATE:20260930T100000Z'], { dateTime: '2026-10-05T12:00:00+02:00' })).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261005T095959Z',
      'EXDATE:20260930T100000Z'
    ])
  })
  it('uses the previous date for all-day series', () => {
    expect(truncateRecurrence(['RRULE:FREQ=DAILY;COUNT=5'], { date: '2026-10-01' })).toEqual(['RRULE:FREQ=DAILY;UNTIL=20260930'])
  })
})

describe('provider timeouts', () => {
  afterEach(() => void (http.timeoutMs = 30_000))

  it('fails a call instead of hanging when Google never answers', async () => {
    http.timeoutMs = 20
    // Settles only by abort, like a stalled socket.
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))))
    await expect(provider().listCalendars()).rejects.toThrow('Request to www.googleapis.com timed out')
  })
})
