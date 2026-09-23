// Runs against a real CalDAV server (e.g. Radicale with --auth-type none). Skipped unless RADICALE_URL is set:
//   RADICALE_URL=http://127.0.0.1:5232/ pnpm vitest run src/main/providers/caldav
import { randomUUID } from 'crypto'
import { getBasicAuthHeaders, makeCalendar } from 'tsdav'
import { describe, expect, it } from 'vitest'
import { createCaldavProvider, verifyCaldav } from './index'

const url = process.env.RADICALE_URL
const username = 'tester@example.com'
const password = 'test'

describe.skipIf(!url)('CalDAV provider against a real server', () => {
  it('creates a calendar, then creates, lists, updates, responds to and deletes an event', async () => {
    const calUrl = new URL(`${encodeURIComponent(username)}/test-${randomUUID()}/`, url).href
    const made = await makeCalendar({
      url: calUrl,
      props: { 'd:displayname': 'Integration', 'ca:calendar-color': '#ff9500ff' },
      headers: getBasicAuthHeaders({ username, password })
    })
    expect(made[0]?.ok ?? true).toBe(true)

    expect(await verifyCaldav({ label: 'x', serverUrl: url!, username, password })).toEqual({ email: username })

    const p = createCaldavProvider({
      accountId: 'acc',
      email: username,
      credentials: { kind: 'caldav', serverUrl: url!, username, password },
      saveCredentials: async () => {}
    })

    const cal = (await p.listCalendars()).find((c) => c.id === calUrl)
    expect(cal).toMatchObject({ name: 'Integration', color: '#ff9500', readOnly: false, accountId: 'acc' })

    const created = await p.createEvent(calUrl, {
      accountId: 'acc',
      calendarId: calUrl,
      title: 'Solo',
      start: '2026-03-02T10:00:00.000Z',
      end: '2026-03-02T11:00:00.000Z',
      allDay: false
    })
    expect(created).toMatchObject({ title: 'Solo', attendees: [] })
    expect(created.organizer).toBeUndefined()
    expect(created.etag).toBeTruthy()

    const range = { start: '2026-03-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' }
    expect((await p.listEvents(calUrl, range)).map((e) => e.id)).toEqual([created.id])

    const updated = await p.updateEvent({ ...created, title: 'Solo (edited)' })
    expect(updated.title).toBe('Solo (edited)')
    expect(updated.etag).not.toBe(created.etag)
    // Stale etag must be rejected.
    await expect(p.updateEvent({ ...created, title: 'stale' })).rejects.toThrow(/changed on the server/)

    const invite = await p.createEvent(calUrl, {
      accountId: 'acc',
      calendarId: calUrl,
      title: 'Meeting',
      start: '2026-03-03T10:00:00.000Z',
      end: '2026-03-03T11:00:00.000Z',
      allDay: false,
      attendees: [username, 'other@example.com']
    })
    expect(invite.organizer?.email).toBe(username)
    expect(invite.myStatus).toBe('needsAction')
    const responded = await p.respond(invite, 'accepted')
    expect(responded.myStatus).toBe('accepted')
    expect(responded.attendees.find((a) => a.email === 'other@example.com')?.status).toBe('needsAction')

    await p.deleteEvent(updated)
    await p.deleteEvent(responded)
    expect(await p.listEvents(calUrl, range)).toEqual([])
  })

  it('rejects a bad URL with a readable error', async () => {
    await expect(verifyCaldav({ label: 'x', serverUrl: 'not a url', username, password })).rejects.toThrow(/Invalid server URL/)
  })
})
