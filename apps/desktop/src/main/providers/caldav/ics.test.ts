import { describe, expect, it } from 'vitest'
import { applyDeleteInstance, applyRespond, applyUpdate, buildIcs, mapPartStat, parseEvents, type CaldavRaw } from './ics'

const ctx = { accountId: 'work', calendarId: 'https://dav.example/cal/', email: 'Me@Work.example' }
const HREF = 'https://dav.example/cal/ev.ics'
const JAN = { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' }

const wrap = (...vevents: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...vevents, 'END:VCALENDAR'].join('\r\n')

const DAILY = wrap(
  [
    'BEGIN:VEVENT',
    'UID:daily-1',
    'DTSTAMP:20251201T000000Z',
    'DTSTART:20260105T090000Z',
    'DTEND:20260105T091500Z',
    'RRULE:FREQ=DAILY;COUNT=5',
    'EXDATE:20260107T090000Z',
    'SUMMARY:Daily standup',
    'ORGANIZER;CN=Boss:mailto:boss@work.example',
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:boss@work.example',
    'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:me@work.example',
    'ATTENDEE;PARTSTAT=TENTATIVE:mailto:other@work.example',
    'END:VEVENT'
  ].join('\r\n'),
  [
    'BEGIN:VEVENT',
    'UID:daily-1',
    'DTSTAMP:20251201T000000Z',
    'RECURRENCE-ID:20260108T090000Z',
    'DTSTART:20260108T100000Z',
    'DTEND:20260108T101500Z',
    'SUMMARY:Standup (moved)',
    'ORGANIZER:mailto:boss@work.example',
    'ATTENDEE;PARTSTAT=DECLINED:mailto:me@work.example',
    'END:VEVENT'
  ].join('\r\n')
)

const ALLDAY = wrap(
  ['BEGIN:VEVENT', 'UID:ad-1', 'DTSTAMP:20251201T000000Z', 'DTSTART;VALUE=DATE:20260110', 'DTEND;VALUE=DATE:20260112', 'SUMMARY:Trip', 'END:VEVENT'].join('\r\n')
)

describe('parseEvents', () => {
  it('expands RRULE with EXDATE and RECURRENCE-ID override', () => {
    const evs = parseEvents(DAILY, HREF, '"e1"', ctx, JAN)
    expect(evs.map((e) => e.start)).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-06T09:00:00.000Z',
      '2026-01-08T10:00:00.000Z',
      '2026-01-09T09:00:00.000Z'
    ])
    const moved = evs[2]
    expect(moved.title).toBe('Standup (moved)')
    expect(moved.id).toBe(`${HREF}#2026-01-08T09:00:00Z`)
    expect(moved.myStatus).toBe('declined')
    expect(moved.recurringEventId).toBe(HREF)
    expect(new Set(evs.map((e) => e.id)).size).toBe(4)
    expect(evs[0].etag).toBe('"e1"')
    expect((evs[0].raw as CaldavRaw).ics).toBe(DAILY)
  })

  it('limits instances to the range', () => {
    const evs = parseEvents(DAILY, HREF, undefined, ctx, { start: '2026-01-06T00:00:00Z', end: '2026-01-07T00:00:00Z' })
    expect(evs).toHaveLength(1)
    expect(evs[0].start).toBe('2026-01-06T09:00:00.000Z')
  })

  it('maps organizer, attendees, PARTSTAT and self', () => {
    const [ev] = parseEvents(DAILY, HREF, undefined, ctx, JAN)
    expect(ev.organizer).toEqual({ email: 'boss@work.example', name: 'Boss' })
    expect(ev.attendees).toEqual([
      { email: 'boss@work.example', status: 'accepted', organizer: true },
      { email: 'me@work.example', status: 'needsAction', self: true },
      { email: 'other@work.example', status: 'tentative' }
    ])
    expect(ev.myStatus).toBe('needsAction')
  })

  it('maps all-day events to date-only, end exclusive', () => {
    const [ev] = parseEvents(ALLDAY, HREF, undefined, ctx, JAN)
    expect(ev).toMatchObject({ allDay: true, start: '2026-01-10', end: '2026-01-12', id: HREF, attendees: [] })
    expect(ev.recurringEventId).toBeUndefined()
    expect(ev.myStatus).toBeUndefined()
  })

  it('resolves TZID via embedded VTIMEZONE', () => {
    const ics = wrap(
      [
        'BEGIN:VTIMEZONE',
        'TZID:Europe/Kyiv',
        'BEGIN:STANDARD',
        'DTSTART:19701025T040000',
        'TZOFFSETFROM:+0300',
        'TZOFFSETTO:+0200',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'DTSTART:19700329T030000',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0300',
        'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
        'END:DAYLIGHT',
        'END:VTIMEZONE'
      ].join('\r\n'),
      ['BEGIN:VEVENT', 'UID:tz', 'DTSTAMP:20251201T000000Z', 'DTSTART;TZID=Europe/Kyiv:20260115T100000', 'DTEND;TZID=Europe/Kyiv:20260115T110000', 'SUMMARY:TZ', 'END:VEVENT'].join('\r\n')
    )
    const [ev] = parseEvents(ics, HREF, undefined, ctx, JAN)
    expect(ev.start).toBe('2026-01-15T08:00:00.000Z')
  })

  it('maps PARTSTAT values case-insensitively', () => {
    expect(mapPartStat('accepted')).toBe('accepted')
    expect(mapPartStat('NEEDS-ACTION')).toBe('needsAction')
    expect(mapPartStat(undefined)).toBe('needsAction')
    expect(mapPartStat('DELEGATED')).toBe('needsAction')
  })
})

describe('buildIcs', () => {
  const base = { accountId: 'work', calendarId: ctx.calendarId, title: 'Focus', start: '2026-01-20T10:00:00.000Z', end: '2026-01-20T11:00:00.000Z', allDay: false }

  it('has no ORGANIZER and no ATTENDEE without attendees', () => {
    const ics = buildIcs('uid-1', base, ctx.email)
    expect(ics).not.toMatch(/ORGANIZER/)
    expect(ics).not.toMatch(/ATTENDEE/)
    const [ev] = parseEvents(ics, HREF, undefined, ctx, JAN)
    expect(ev).toMatchObject({ title: 'Focus', start: base.start, end: base.end, allDay: false, attendees: [] })
    expect(ev.organizer).toBeUndefined()
  })

  it('sets ORGANIZER to own identity and adds only the listed attendees', () => {
    const ics = buildIcs('uid-2', { ...base, attendees: ['A@x.example', 'a@x.example', 'b@x.example'] }, ctx.email)
    const [ev] = parseEvents(ics, HREF, undefined, ctx, JAN)
    expect(ev.organizer?.email).toBe('me@work.example')
    expect(ev.attendees.map((a) => [a.email, a.status])).toEqual([
      ['a@x.example', 'needsAction'],
      ['b@x.example', 'needsAction']
    ])
  })

  it('writes all-day events as VALUE=DATE', () => {
    const ics = buildIcs('uid-3', { ...base, allDay: true, start: '2026-01-20', end: '2026-01-21' }, ctx.email)
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20260120/)
    expect(parseEvents(ics, HREF, undefined, ctx, JAN)[0]).toMatchObject({ allDay: true, start: '2026-01-20', end: '2026-01-21' })
  })
})

describe('applyRespond', () => {
  const raw: CaldavRaw = { href: HREF, ics: DAILY }

  it('changes only own ATTENDEE PARTSTAT and keeps ORGANIZER', () => {
    const out = applyRespond(raw, ctx.email, 'accepted')
    const [first] = parseEvents(out, HREF, undefined, ctx, JAN)
    expect(first.attendees).toEqual([
      { email: 'boss@work.example', status: 'accepted', organizer: true },
      { email: 'me@work.example', status: 'accepted', self: true },
      { email: 'other@work.example', status: 'tentative' }
    ])
    expect(first.organizer).toEqual({ email: 'boss@work.example', name: 'Boss' })
    expect(out).toMatch(/RRULE:FREQ=DAILY;COUNT=5/)
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })

  it('throws when the account is not an attendee', () => {
    expect(() => applyRespond(raw, 'stranger@else.example', 'accepted')).toThrow(/not an attendee/)
  })
})

describe('applyUpdate', () => {
  it('modifies the VEVENT in place and keeps other props/components', () => {
    const ics = wrap(
      ['BEGIN:VEVENT', 'UID:u1', 'DTSTAMP:20251201T000000Z', 'DTSTART:20260120T100000Z', 'DURATION:PT1H', 'SUMMARY:Old', 'X-CUSTOM:keep-me', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT'].join('\r\n')
    )
    const [ev] = parseEvents(ics, HREF, '"e"', ctx, JAN)
    const out = applyUpdate({ ...ev, title: 'New', end: '2026-01-20T12:00:00.000Z' }, ctx.email)
    expect(out).toMatch(/X-CUSTOM:keep-me/)
    expect(out).toMatch(/BEGIN:VALARM/)
    expect(out).not.toMatch(/DURATION/)
    expect(out).not.toMatch(/ORGANIZER/)
    expect(parseEvents(out, HREF, undefined, ctx, JAN)[0]).toMatchObject({ title: 'New', end: '2026-01-20T12:00:00.000Z' })
  })

  it('writes an override for a recurring instance and leaves the series intact', () => {
    const inst = parseEvents(DAILY, HREF, undefined, ctx, JAN)[1] // Jan 6
    const out = applyUpdate({ ...inst, title: 'Only Jan 6' }, ctx.email)
    const evs = parseEvents(out, HREF, undefined, ctx, JAN)
    expect(evs.map((e) => e.title)).toEqual(['Daily standup', 'Only Jan 6', 'Standup (moved)', 'Daily standup'])
    expect(evs[1].id).toBe(inst.id)
  })
})

describe('TZID series', () => {
  const ics = wrap(
    ['BEGIN:VTIMEZONE', 'TZID:Test/Plus2', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0200', 'END:STANDARD', 'END:VTIMEZONE'].join('\r\n'),
    ['BEGIN:VEVENT', 'UID:w', 'DTSTAMP:20251201T000000Z', 'DTSTART;TZID=Test/Plus2:20260105T100000', 'DTEND;TZID=Test/Plus2:20260105T110000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Weekly', 'END:VEVENT'].join('\r\n')
  )

  it('writes override RECURRENCE-ID and EXDATE with the master TZID', () => {
    const [, second] = parseEvents(ics, HREF, undefined, ctx, JAN)
    expect(second.start).toBe('2026-01-12T08:00:00.000Z')
    const edited = applyUpdate({ ...second, title: 'Once' }, ctx.email)
    expect(edited).toMatch(/RECURRENCE-ID;TZID=Test\/Plus2:20260112T100000/)
    expect(parseEvents(edited, HREF, undefined, ctx, JAN).map((e) => e.title)).toEqual(['Weekly', 'Once', 'Weekly'])
    const deleted = applyDeleteInstance(second.raw as CaldavRaw)!
    expect(deleted).toMatch(/EXDATE;TZID=Test\/Plus2:20260112T100000/)
    expect(parseEvents(deleted, HREF, undefined, ctx, JAN)).toHaveLength(2)
  })

  it('matches an existing override written with a UTC RECURRENCE-ID', () => {
    const withUtcOverride = ics.replace(
      'END:VCALENDAR',
      ['BEGIN:VEVENT', 'UID:w', 'DTSTAMP:20251201T000000Z', 'RECURRENCE-ID:20260112T080000Z', 'DTSTART:20260112T090000Z', 'DTEND:20260112T100000Z', 'SUMMARY:Moved', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    )
    const moved = parseEvents(withUtcOverride, HREF, undefined, ctx, JAN).find((e) => e.title === 'Moved')!
    const edited = applyUpdate({ ...moved, title: 'Moved again' }, ctx.email)
    expect(edited.match(/RECURRENCE-ID/g)).toHaveLength(1)
    const deleted = applyDeleteInstance(moved.raw as CaldavRaw)!
    expect(deleted).not.toMatch(/RECURRENCE-ID/)
  })
})

describe('moved instances', () => {
  it('finds an instance moved earlier into the range from a later slot', () => {
    const ics = DAILY.replace('RECURRENCE-ID:20260108T090000Z', 'RECURRENCE-ID:20260109T090000Z').replace('DTSTART:20260108T100000Z', 'DTSTART:20260105T200000Z').replace('DTEND:20260108T101500Z', 'DTEND:20260105T201500Z')
    const evs = parseEvents(ics, HREF, undefined, ctx, { start: '2026-01-05T00:00:00Z', end: '2026-01-06T00:00:00Z' })
    expect(evs.map((e) => e.title)).toEqual(['Daily standup', 'Standup (moved)'])
  })

  it('deleting a lone orphan override asks to delete the whole object', () => {
    const orphan = wrap(['BEGIN:VEVENT', 'UID:o', 'DTSTAMP:20251201T000000Z', 'RECURRENCE-ID:20260112T080000Z', 'DTSTART:20260112T080000Z', 'DTEND:20260112T090000Z', 'SUMMARY:One', 'END:VEVENT'].join('\r\n'))
    const [ev] = parseEvents(orphan, HREF, undefined, ctx, JAN)
    expect(applyDeleteInstance(ev.raw as CaldavRaw)).toBeNull()
  })
})

describe('applyDeleteInstance', () => {
  it('adds EXDATE and drops the override', () => {
    const moved = parseEvents(DAILY, HREF, undefined, ctx, JAN)[2]
    const out = applyDeleteInstance(moved.raw as CaldavRaw)!
    expect(parseEvents(out, HREF, undefined, ctx, JAN).map((e) => e.start)).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-06T09:00:00.000Z',
      '2026-01-09T09:00:00.000Z'
    ])
  })
})
