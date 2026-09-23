import { describe, expect, it } from 'vitest'
import type { Account, Calendar, CalEvent } from '@shared/types'
import { canEdit, cleanNotes, formatWhen, linkify, ownerLine, pendingInvites } from './EventDetails.logic'

const account: Account = { id: 'work', kind: 'caldav', label: 'Work', email: 'me@work.example', color: '#000' }
const cal: Calendar = { id: 'w', accountId: 'work', name: 'Work', color: '#000', readOnly: false }
const ev = (p: Partial<CalEvent> = {}): CalEvent => ({
  id: '1', accountId: 'work', calendarId: 'w', title: 'T', start: '2026-09-24T12:00:00.000Z', end: '2026-09-24T13:00:00.000Z',
  allDay: false, attendees: [], ...p
})

describe('canEdit', () => {
  it('allows plain events in writable calendars', () => {
    expect(canEdit(ev(), account, cal)).toBe(true)
    expect(canEdit(ev(), account, { ...cal, readOnly: true })).toBe(false)
    expect(canEdit(ev(), undefined, cal)).toBe(false)
  })
  it('allows only the organizer when there are attendees', () => {
    const attendees = [{ email: 'pm@work.example', status: 'accepted' as const, organizer: true }]
    expect(canEdit(ev({ attendees, organizer: { email: 'pm@work.example' } }), account, cal)).toBe(false)
    expect(canEdit(ev({ attendees, organizer: { email: 'ME@work.example' } }), account, cal)).toBe(true)
  })
})

describe('pendingInvites', () => {
  it('keeps upcoming needsAction events sorted', () => {
    const now = new Date('2026-09-24T12:30:00Z')
    const list = pendingInvites(
      [
        ev({ id: 'past', myStatus: 'needsAction', end: '2026-09-24T12:00:00.000Z' }),
        ev({ id: 'b', myStatus: 'needsAction', start: '2026-09-26T10:00:00.000Z', end: '2026-09-26T11:00:00.000Z' }),
        ev({ id: 'a', myStatus: 'needsAction' }),
        ev({ id: 'ok', myStatus: 'accepted' })
      ],
      now
    )
    expect(list.map((e) => e.id)).toEqual(['a', 'b'])
    const mixed = pendingInvites([
      ev({ id: 'z', myStatus: 'needsAction', start: '2026-09-25T07:00:00Z', end: '2026-09-25T08:00:00Z' }),
      ev({ id: 'offset', myStatus: 'needsAction', start: '2026-09-25T09:00:00+03:00', end: '2026-09-25T10:00:00+03:00' })
    ], now)
    expect(mixed.map((e) => e.id)).toEqual(['offset', 'z'])
  })
})

describe('formatWhen', () => {
  it('formats all-day ranges inclusively', () => {
    expect(formatWhen(ev({ allDay: true, start: '2026-09-24', end: '2026-09-25' }))).toBe('Thu, 24 Sep · all day')
    expect(formatWhen(ev({ allDay: true, start: '2026-09-24', end: '2026-09-26' }))).toBe('Thu, 24 Sep – Fri, 25 Sep · all day')
  })
})

describe('linkify', () => {
  it('returns plain text untouched', () => {
    expect(linkify('Room 3')).toEqual([{ text: 'Room 3' }])
    expect(linkify('')).toEqual([])
  })
  it('splits http(s) urls and strips trailing punctuation', () => {
    expect(linkify('Join https://meet.example.com/a?b=1. Or (http://x.io/y), ok')).toEqual([
      { text: 'Join ' },
      { text: 'https://meet.example.com/a?b=1', href: 'https://meet.example.com/a?b=1' },
      { text: '. Or (' },
      { text: 'http://x.io/y', href: 'http://x.io/y' },
      { text: '), ok' }
    ])
    expect(linkify('https://a.io')).toEqual([{ text: 'https://a.io', href: 'https://a.io' }])
  })
  it('ignores non-http schemes', () => {
    expect(linkify('javascript:alert(1) ftp://x')).toEqual([{ text: 'javascript:alert(1) ftp://x' }])
  })
})

describe('ownerLine', () => {
  const g = 'me@gmail.com'
  it('collapses Google primary (calendar = label = email) to one email', () => {
    expect(ownerLine(g, g, g)).toEqual({ calendar: undefined, label: g, email: undefined })
  })
  it('keeps a Google secondary calendar, drops the repeated email', () => {
    expect(ownerLine('Pets', g, g)).toEqual({ calendar: 'Pets', label: g, email: undefined })
  })
  it('keeps all parts when distinct (CalDAV)', () => {
    expect(ownerLine('Home', 'Work', 'me@work.example')).toEqual({ calendar: 'Home', label: 'Work', email: 'me@work.example' })
  })
  it('compares case-insensitively and trimmed', () => {
    expect(ownerLine(' Me@Gmail.com', 'me@gmail.com', 'ME@GMAIL.COM ')).toEqual({ calendar: undefined, label: 'me@gmail.com', email: undefined })
    expect(ownerLine('work', 'Work', 'me@work.example')).toEqual({ calendar: undefined, label: 'Work', email: 'me@work.example' })
  })
  it('handles a missing email', () => {
    expect(ownerLine('Home', 'Work')).toEqual({ calendar: 'Home', label: 'Work', email: undefined })
  })
})

describe('cleanNotes', () => {
  it('drops color metadata lines, keeps real notes', () => {
    expect(cleanNotes('@color:5\n@colorHex:#FFDB17')).toBe('')
    expect(cleanNotes('Agenda\n@color:5\n@colorHex:#FFDB17\nBring laptop')).toBe('Agenda\nBring laptop')
    expect(cleanNotes('mail me @color: not at line start')).toBe('mail me @color: not at line start')
    expect(cleanNotes(undefined)).toBe('')
  })
})
