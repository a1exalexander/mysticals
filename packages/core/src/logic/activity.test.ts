import { describe, expect, it } from 'vitest'
import type { CalEvent } from '../shared/types'
import { fieldChanges, remoteChanges, snap } from './activity'

const ev = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: 'e1',
  accountId: 'work',
  calendarId: 'cal',
  title: 'Retro',
  start: '2026-10-09T10:00:00Z',
  end: '2026-10-09T11:00:00Z',
  allDay: false,
  organizer: { email: 'halyna@work.example' },
  attendees: [
    { email: 'halyna@work.example', status: 'accepted', organizer: true },
    { email: 'me@work.example', status: 'needsAction', self: true }
  ],
  myStatus: 'needsAction',
  raw: 'BEGIN:VCALENDAR…',
  etag: 'x',
  ...over
})
const cache = (events: CalEvent[], syncedAt = '2026-10-07T18:00:00Z') => ({ calendars: [], events, syncedAt })

describe('snap', () => {
  it('drops provider payloads and cuts long texts', () => {
    const s = snap(ev({ description: 'x'.repeat(5000) }))
    expect(s).not.toHaveProperty('raw')
    expect(s).not.toHaveProperty('etag')
    expect(s.description!.length).toBeLessThan(2100)
  })
})

describe('fieldChanges', () => {
  it('catches an organizer taken over by another address and attendee RSVPs', () => {
    const before = ev()
    const after = ev({
      organizer: { email: 'me@gmail.example' },
      attendees: [{ email: 'Halyna@work.example', status: 'needsAction' }, { email: 'me@work.example', status: 'accepted', self: true }],
      myStatus: 'accepted'
    })
    expect(fieldChanges(before, after)).toEqual([
      { field: 'myStatus', from: 'needsAction', to: 'accepted' },
      { field: 'organizer', from: 'halyna@work.example', to: 'me@gmail.example' },
      { field: 'attendee:halyna@work.example', from: 'accepted', to: 'needsAction' },
      { field: 'attendee:me@work.example', from: 'needsAction', to: 'accepted' }
    ])
  })

  it('reports added and removed attendees and nothing for equal events', () => {
    expect(fieldChanges(ev(), ev())).toEqual([])
    const more = ev({ attendees: [...ev().attendees, { email: 'new@work.example', status: 'needsAction' }] })
    expect(fieldChanges(ev(), more)).toEqual([{ field: 'attendee:new@work.example', from: undefined, to: 'needsAction' }])
    expect(fieldChanges(more, ev())).toEqual([{ field: 'attendee:new@work.example', from: 'needsAction', to: undefined }])
  })
})

describe('remoteChanges', () => {
  it('lists added, changed and removed events', () => {
    const prev = cache([ev(), ev({ id: 'gone', title: 'Old' })])
    const next = cache([ev({ title: 'Retro v2' }), ev({ id: 'new', title: 'New' })], '2026-10-07T19:00:00Z')
    const out = remoteChanges(prev, next)
    expect(out.map((c) => [c.kind, c.event?.id])).toEqual([
      ['remote.change', 'e1'],
      ['remote.add', 'new'],
      ['remote.remove', 'gone']
    ])
    expect(out[0].changes).toEqual([{ field: 'title', from: 'Retro', to: 'Retro v2' }])
  })

  it('ignores events that only slid in or out of the synced window', () => {
    const old = ev({ id: 'old', start: '2026-07-01T10:00:00Z', end: '2026-07-01T11:00:00Z' })
    const far = ev({ id: 'far', start: '2027-01-08T10:00:00Z', end: '2027-01-08T11:00:00Z' })
    expect(remoteChanges(cache([old]), cache([far], '2026-10-08T18:00:00Z'))).toEqual([])
  })

  it('collapses instances of one series changed the same way', () => {
    const inst = (n: number, title: string) =>
      ev({ id: `s_${n}`, recurringEventId: 's', title, start: `2026-10-1${n}T10:00:00Z`, end: `2026-10-1${n}T11:00:00Z` })
    const out = remoteChanges(cache([1, 2, 3].map((n) => inst(n, 'A'))), cache([1, 2, 3].map((n) => inst(n, 'B'))))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'remote.change', instances: 3, changes: [{ field: 'title', from: 'A', to: 'B' }] })
  })
})
