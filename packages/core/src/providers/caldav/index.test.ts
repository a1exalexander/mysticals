import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { fetchCalendars } from 'tsdav'
import { describe, expect, it } from 'vitest'
import { AuthError } from '../http'
import { davFetch, toCalendar } from './index'

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
