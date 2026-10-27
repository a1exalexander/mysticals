import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { fetchCalendars } from 'tsdav'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '../../shared/types'
import { AuthError } from '../http'
import { createCaldavProvider, davFetch, toCalendar } from './index'

// Real tsdav unless a test sets `dav.cals`; then the server is faked and REPORTs are counted.
const dav = vi.hoisted(() => ({
  cals: undefined as { url: string; ctag?: string }[] | undefined,
  addresses: ['mailto:u@example.com'] as string[],
  addressLookups: 0,
  reports: 0,
  onReport: undefined as (() => Promise<unknown>) | undefined
}))
vi.mock('tsdav', async (importOriginal) => {
  const real = await importOriginal<typeof import('tsdav')>()
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'DTSTART:20260101T100000Z', 'DTEND:20260101T110000Z', 'SUMMARY:A', 'ORGANIZER:mailto:o@example.com', 'ATTENDEE:mailto:u@example.com', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  return {
    ...real,
    createAccount: (async (o) => (dav.cals ? o.account : real.createAccount(o))) as typeof real.createAccount,
    fetchCalendars: (async (o) => dav.cals ?? real.fetchCalendars(o)) as typeof real.fetchCalendars,
    fetchCalendarUserAddresses: (async (o) => {
      if (!dav.cals) return real.fetchCalendarUserAddresses(o)
      dav.addressLookups++
      return dav.addresses
    }) as typeof real.fetchCalendarUserAddresses,
    fetchCalendarObjects: (async (o) => {
      if (!dav.cals) return real.fetchCalendarObjects(o)
      if (o.timeRange) {
        dav.reports++
        await dav.onReport?.()
      }
      return [{ url: `${o.calendar.url}a.ics`, etag: '"1"', data: ics }]
    }) as typeof real.fetchCalendarObjects,
    createCalendarObject: (async (o) => (dav.cals ? new Response(null, { status: 201 }) : real.createCalendarObject(o))) as typeof real.createCalendarObject,
    updateCalendarObject: (async (o) => (dav.cals ? new Response(null, { status: 204 }) : real.updateCalendarObject(o))) as typeof real.updateCalendarObject,
    deleteCalendarObject: (async (o) => (dav.cals ? new Response(null, { status: 204 }) : real.deleteCalendarObject(o))) as typeof real.deleteCalendarObject
  }
})

describe('toCalendar', () => {
  const base = { url: 'https://dav.example/u/work/', displayName: 'Work', calendarColor: '#FF9500FF' }

  it('maps name, trims Apple 8-digit color, writable by default', () => {
    expect(toCalendar(base, 'acc')).toEqual({ id: base.url, accountId: 'acc', name: 'Work', color: '#FF9500', readOnly: false })
  })

  it('falls back to URL segment and gray color', () => {
    expect(toCalendar({ url: 'https://dav.example/u/my%20cal/' }, 'acc')).toMatchObject({ name: 'my cal', color: '#8e8e93' })
  })

  it('is readOnly when privileges lack write', () => {
    const ro = { ...base, projectedProps: { currentUserPrivilegeSet: { privilege: [{ read: {} }] } } }
    const rw = { ...base, projectedProps: { currentUserPrivilegeSet: { privilege: [{ read: {} }, { writeContent: {} }] } } }
    expect(toCalendar(ro, 'acc').readOnly).toBe(true)
    expect(toCalendar(rw, 'acc').readOnly).toBe(false)
  })
})

describe('davFetch', () => {
  it('turns a 401 into an AuthError, which tsdav alone reports as "no calendars"', async () => {
    const server = createServer((_req, res) => res.writeHead(401).end())
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const homeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cal/`
    const account = { serverUrl: homeUrl, rootUrl: homeUrl, homeUrl, accountType: 'caldav' as const }
    try {
      expect(await fetchCalendars({ account, fetch })).toEqual([])
      await expect(fetchCalendars({ account, fetch: davFetch })).rejects.toBeInstanceOf(AuthError)
    } finally {
      server.close()
    }
  })
})

describe('ctag memo', () => {
  const cal = 'https://dav.example/u/work/'
  const range = { start: '2025-10-01T00:00:00Z', end: '2026-04-01T00:00:00Z' }
  const credentials = { kind: 'caldav' as const, serverUrl: 'https://dav.example/', username: 'u', password: 'p' }
  const make = () => createCaldavProvider({ accountId: 'acc', email: 'u@example.com', credentials, saveCredentials: async () => {} })
  const syncPass = async (p: ReturnType<typeof make>, ctag?: string) => {
    dav.cals = [{ url: cal, ctag }]
    await p.listCalendars()
    return p.listEvents(cal, range)
  }

  beforeEach(() => {
    dav.reports = 0
    return () => {
      dav.cals = undefined
      dav.onReport = undefined
      vi.useRealTimers()
    }
  })

  it('skips the REPORT while the ctag is unchanged', async () => {
    const p = make()
    const first = await syncPass(p, '1')
    expect(first).toHaveLength(1)
    expect(await syncPass(p, '1')).toEqual(first)
    expect(dav.reports).toBe(1)
  })

  it('refetches when the ctag changes', async () => {
    const p = make()
    await syncPass(p, '1')
    await syncPass(p, '2')
    expect(dav.reports).toBe(2)
  })

  it('refetches every pass when the server sends no ctag', async () => {
    const p = make()
    await syncPass(p)
    await syncPass(p)
    expect(dav.reports).toBe(2)
  })

  it('reuses the memo for under a day, refetches once it is a day old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const p = make()
    await syncPass(p, '1')
    vi.advanceTimersByTime(864e5 - 1)
    await syncPass(p, '1')
    expect(dav.reports).toBe(1)
    vi.advanceTimersByTime(1)
    await syncPass(p, '1')
    expect(dav.reports).toBe(2)
  })

  const writes: Record<string, (p: ReturnType<typeof make>, ev: CalEvent) => Promise<unknown>> = {
    createEvent: (p, ev) => p.createEvent(cal, { accountId: 'acc', calendarId: cal, title: 'B', start: ev.start, end: ev.end, allDay: false }),
    updateEvent: (p, ev) => p.updateEvent({ ...ev, title: 'B' }),
    deleteEvent: (p, ev) => p.deleteEvent(ev, 'all'),
    respond: (p, ev) => p.respond(ev, 'accepted'),
    setColor: (p, ev) => p.setColor(ev, null, 'one')
  }

  it.each(Object.keys(writes))('refetches after an own %s', async (name) => {
    const p = make()
    const [ev] = await syncPass(p, '1')
    await writes[name]!(p, ev!)
    await syncPass(p, '1')
    expect(dav.reports).toBe(2)
  })

  it('does not memo a REPORT that overlapped an own write', async () => {
    const p = make()
    const [ev] = await syncPass(p, '1')
    dav.onReport = () => ((dav.onReport = undefined), p.deleteEvent(ev!, 'all'))
    await syncPass(p, '2')
    await syncPass(p, '2')
    expect(dav.reports).toBe(3)
  })

  it('forgets calendars that are gone', async () => {
    const p = make()
    await syncPass(p, '1')
    dav.cals = []
    await p.listCalendars()
    await syncPass(p, '1')
    expect(dav.reports).toBe(2)
  })
})

describe('account addresses', () => {
  const cal = 'https://dav.example/u/work/'
  const range = { start: '2025-10-01T00:00:00Z', end: '2026-04-01T00:00:00Z' }
  const credentials = { kind: 'caldav' as const, serverUrl: 'https://dav.example/', username: 'u', password: 'p' }

  beforeEach(() => {
    dav.cals = [{ url: cal }]
    dav.addressLookups = 0
    return () => {
      dav.cals = undefined
      dav.addresses = ['mailto:u@example.com']
    }
  })

  it('looks up and stores an older account\'s other addresses once, and knows invites to them as its own', async () => {
    // The fake object invites u@example.com; the account's email is its other address.
    dav.addresses = ['mailto:Me@iCloud.example', 'mailto:U@example.com', '/123/principal/', 'mailto:u@example.com']
    const saveAliases = vi.fn(async () => {})
    const p = createCaldavProvider({ accountId: 'acc', email: 'me@icloud.example', credentials, saveCredentials: async () => {}, saveAliases })
    await p.listCalendars()
    const [ev] = await p.listEvents(cal, range)
    expect(saveAliases).toHaveBeenCalledExactlyOnceWith(['u@example.com'])
    expect(ev!.myStatus).toBe('needsAction')
    await p.respond(ev!, 'accepted')
    expect(dav.addressLookups).toBe(1)
  })

  it('uses stored addresses without asking the server', async () => {
    const saveAliases = vi.fn(async () => {})
    const p = createCaldavProvider({ accountId: 'acc', email: 'me@icloud.example', aliases: [], credentials, saveCredentials: async () => {}, saveAliases })
    await p.listCalendars()
    const [ev] = await p.listEvents(cal, range)
    expect(ev!.myStatus).toBeUndefined()
    expect(dav.addressLookups).toBe(0)
    expect(saveAliases).not.toHaveBeenCalled()
  })
})
