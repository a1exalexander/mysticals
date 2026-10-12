// Runs against a real CalDAV server (e.g. Radicale with --auth-type none). Skipped unless RADICALE_URL is set:
//   RADICALE_URL=http://127.0.0.1:5232/ pnpm vitest run src/main/providers/caldav
import { randomUUID } from 'crypto'
import { createCalendarObject, getBasicAuthHeaders, makeCalendar } from 'tsdav'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createCaldavProvider, verifyCaldav } from './index'

const url = process.env.RADICALE_URL
const username = 'tester@example.com'
const password = 'test'
const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

describe.skipIf(!url)('CalDAV provider against a real server', () => {
  it('creates a calendar, then creates, lists, updates, responds to and deletes an event', async () => {
    const calUrl = new URL(`${encodeURIComponent(username)}/test-${randomUUID()}/`, url).href
    const made = await makeCalendar({
      url: calUrl,
      props: { 'd:displayname': 'Integration', 'ca:calendar-color': '#ff9500ff' },
      headers: getBasicAuthHeaders({ username, password })
    })
    expect(made[0]?.ok ?? true).toBe(true)

    expect(await run(verifyCaldav({ label: 'x', serverUrl: url!, username, password }))).toEqual({ email: username })

    const p = await run(createCaldavProvider({
      accountId: 'acc',
      email: username,
      credentials: { kind: 'caldav', serverUrl: url!, username, password },
      saveCredentials: () => Effect.void
    }))

    const cal = (await run(p.listCalendars())).find((c) => c.id === calUrl)
    expect(cal).toMatchObject({ name: 'Integration', color: '#ff9500', readOnly: false, accountId: 'acc' })

    const created = await run(p.createEvent(calUrl, {
      accountId: 'acc',
      calendarId: calUrl,
      title: 'Solo',
      start: '2026-03-02T10:00:00.000Z',
      end: '2026-03-02T11:00:00.000Z',
      allDay: false
    }))
    expect(created).toMatchObject({ title: 'Solo', attendees: [] })
    expect(created.organizer).toBeUndefined()
    expect(created.etag).toBeTruthy()

    const range = { start: '2026-03-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' }
    expect((await run(p.listEvents(calUrl, range))).map((e) => e.id)).toEqual([created.id])

    const updated = await run(p.updateEvent({ ...created, title: 'Solo (edited)' }))
    expect(updated.title).toBe('Solo (edited)')
    expect(updated.etag).not.toBe(created.etag)
    // Stale etag must be rejected.
    await expect(run(p.updateEvent({ ...created, title: 'stale' }))).rejects.toThrow(/changed on the server/)

    const invite = await run(p.createEvent(calUrl, {
      accountId: 'acc',
      calendarId: calUrl,
      title: 'Meeting',
      start: '2026-03-03T10:00:00.000Z',
      end: '2026-03-03T11:00:00.000Z',
      allDay: false,
      attendees: [username, 'other@example.com']
    }))
    expect(invite.organizer?.email).toBe(username)
    expect(invite.myStatus).toBe('needsAction')
    const responded = await run(p.respond(invite, 'accepted'))
    expect(responded.myStatus).toBe('accepted')
    expect(responded.attendees.find((a) => a.email === 'other@example.com')?.status).toBe('needsAction')

    await run(p.deleteEvent(updated))
    await run(p.deleteEvent(responded))
    expect(await run(p.listEvents(calUrl, range))).toEqual([])
  })

  it('edits a recurring series: this and following splits it, all events rewrites it', async () => {
    const calUrl = new URL(`${encodeURIComponent(username)}/test-${randomUUID()}/`, url).href
    const headers = getBasicAuthHeaders({ username, password })
    await makeCalendar({ url: calUrl, props: { 'd:displayname': 'Series' }, headers })
    const iCalString = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN',
      'BEGIN:VEVENT', 'UID:series-1', 'DTSTAMP:20260101T000000Z', 'DTSTART:20260302T090000Z', 'DTEND:20260302T093000Z',
      'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n')
    await createCalendarObject({ calendar: { url: calUrl }, filename: 'series-1.ics', iCalString, headers })
    const p = await run(createCaldavProvider({ accountId: 'acc', email: username, credentials: { kind: 'caldav', serverUrl: url!, username, password }, saveCredentials: () => Effect.void }))
    const range = { start: '2026-03-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' }
    const list = async () => (await run(p.listEvents(calUrl, range))).sort((a, b) => a.start.localeCompare(b.start))

    const third = (await list())[2]
    const split = await run(p.updateEvent({ ...third, title: 'Sync', start: '2026-03-04T10:00:00.000Z', end: '2026-03-04T10:30:00.000Z' }, 'following'))
    expect(split).toMatchObject({ title: 'Sync', start: '2026-03-04T10:00:00.000Z' })
    let evs = await list()
    expect(evs.map((e) => `${e.start.slice(5, 16)} ${e.title}`)).toEqual([
      '03-02T09:00 Standup', '03-03T09:00 Standup', '03-04T10:00 Sync', '03-05T10:00 Sync', '03-06T10:00 Sync'
    ])

    const all = await run(p.updateEvent({ ...evs[0], title: 'Daily' }, 'all'))
    expect(all.title).toBe('Daily')
    evs = await list()
    expect(evs.map((e) => e.title)).toEqual(['Daily', 'Daily', 'Sync', 'Sync', 'Sync'])
  })

  it('creates a repeating event, changes its rule and stops it', async () => {
    const calUrl = new URL(`${encodeURIComponent(username)}/test-${randomUUID()}/`, url).href
    await makeCalendar({ url: calUrl, props: { 'd:displayname': 'Rules' }, headers: getBasicAuthHeaders({ username, password }) })
    const p = await run(createCaldavProvider({ accountId: 'acc', email: username, credentials: { kind: 'caldav', serverUrl: url!, username, password }, saveCredentials: () => Effect.void }))
    const range = { start: '2026-03-01T00:00:00.000Z', end: '2026-05-01T00:00:00.000Z' }
    const list = async () => (await run(p.listEvents(calUrl, range))).sort((a, b) => a.start.localeCompare(b.start))

    const first = await run(p.createEvent(calUrl, { accountId: 'acc', calendarId: calUrl, title: 'Gym', start: '2026-03-02T18:00:00.000Z', end: '2026-03-02T19:00:00.000Z', allDay: false, recurrence: { freq: 'daily', count: 3 } }))
    expect(first.start).toBe('2026-03-02T18:00:00.000Z')
    expect((await list()).map((e) => e.start.slice(0, 10))).toEqual(['2026-03-02', '2026-03-03', '2026-03-04'])
    expect(await run(p.getRecurrence(first))).toEqual({ freq: 'daily', count: 3 })

    await run(p.updateEvent({ ...(await list())[0], recurrence: { freq: 'weekly', count: 2 } }, 'all'))
    expect((await list()).map((e) => e.start.slice(0, 10))).toEqual(['2026-03-02', '2026-03-09'])

    await run(p.updateEvent({ ...(await list())[1], title: 'Once', recurrence: null }, 'all'))
    const evs = await list()
    expect(evs.map((e) => [e.title, e.start.slice(0, 10)])).toEqual([['Once', '2026-03-09']])
    expect(evs[0].recurringEventId).toBeUndefined()

    const repeated = await run(p.updateEvent({ ...evs[0], recurrence: { freq: 'monthly', count: 2 } }))
    expect(repeated.recurringEventId).toBeTruthy()
    expect((await list()).map((e) => e.start.slice(0, 10))).toEqual(['2026-03-09', '2026-04-09'])
  })

  it('rejects a bad URL with a readable error', async () => {
    await expect(run(verifyCaldav({ label: 'x', serverUrl: 'not a url', username, password }))).rejects.toThrow(/Invalid server URL/)
  })
})
