import { describe, expect, it } from 'vitest'
import type { Account, Calendar, CalEvent } from '../shared/types'
import { accountName, canEdit, cleanNotes, extraEmail, formatWhen, htmlToText, isHtml, linkify, ownerLine, pendingInvites } from './details'

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
        ev({ id: 'ok', myStatus: 'accepted' }),
        ev({ id: 'mine', myStatus: 'needsAction', attendees: [{ email: 'me@work.example', status: 'needsAction', self: true, organizer: true }] })
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
    expect(formatWhen(ev({ allDay: true, start: '2026-09-24', end: '2026-09-25' }), 'uk')).toBe('чт, 24 верес. · весь день')
  })
  it('formats times in 24 or 12 hours', () => {
    const e = ev({ start: new Date(2026, 8, 24, 9, 30).toISOString(), end: new Date(2026, 8, 24, 14, 0).toISOString() })
    expect(formatWhen(e)).toBe('Thu, 24 Sep · 09:30 – 14:00')
    expect(formatWhen(e, 'en', true)).toBe('Thu, 24 Sep · 9:30 AM – 2:00 PM')
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

describe('extraEmail', () => {
  it('drops an email that only repeats the label', () => {
    expect(extraEmail('me@gmail.com', ' ME@gmail.com')).toBeUndefined()
  })
  it('keeps an email that adds to the label', () => {
    expect(extraEmail('Work', 'me@work.example')).toBe('me@work.example')
    expect(extraEmail('Work')).toBeUndefined()
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

describe('isHtml', () => {
  it('detects html fragments, not plain notes', () => {
    expect(isHtml('<a href="https://x.io">x</a><br>hi')).toBe(true)
    expect(isHtml('Line<BR/>next')).toBe(true)
    expect(isHtml('a < b and c > d')).toBe(false)
    expect(isHtml('mail <me@x.io>')).toBe(false)
  })
})

describe('htmlToText', () => {
  it('turns a Google description into readable text', () => {
    const html = '<a href="https://track.example.com/browse/PH-1" rel="noopener noreferrer" target="_blank">https://track.example.com/browse/PH-1</a><br>AI run 2.0 &amp; more.<br>'
    expect(htmlToText(html)).toBe('https://track.example.com/browse/PH-1\nAI run 2.0 & more.')
  })
  it('keeps the url of a named link, lists and paragraphs', () => {
    expect(htmlToText('<p>See <a href="https://x.io/a?b=1&amp;c=2">docs</a></p><ul><li>one</li><li><b>two</b></li></ul>')).toBe(
      'See docs (https://x.io/a?b=1&c=2)\n\n• one\n• two'
    )
  })
  it('drops scripts and styles and decodes entities', () => {
    expect(htmlToText('<script>alert(1)</script><style>p{}</style>a&nbsp;&lt;b&gt; &#39;c&#x27;')).toBe("a <b> 'c'")
  })
})

describe('accountName', () => {
  it('keeps a real label', () => {
    expect(accountName('Work', 'me@work.example')).toBe('Work')
  })
  it('falls back to the mail domain when the label is the email or empty', () => {
    expect(accountName('alexander.ratushnyi@gmail.com', 'alexander.ratushnyi@gmail.com')).toBe('gmail')
    expect(accountName('Me@Namecheap.com', 'me@namecheap.com')).toBe('namecheap')
    expect(accountName('', 'me@foo.co.uk')).toBe('foo')
    expect(accountName('me@mail.example.org', 'me@mail.example.org')).toBe('example')
  })
  it('keeps the label when there is no usable email', () => {
    expect(accountName('me@x', undefined)).toBe('me@x')
  })
})
