import { describe, expect, it } from 'vitest'
import type { CalEvent } from '../shared/types'
import { dueReminders, isReminderMin, loadReminded, pruneReminded, reminderKey, reminderText, splitReminders } from './reminders'

const ev = (id: string, p: Partial<CalEvent> = {}): CalEvent => ({
  id, accountId: 'a', calendarId: 'c', title: id, start: '2026-10-02T10:00:00', end: '2026-10-02T10:30:00',
  allDay: false, attendees: [], ...p
})
const at = (hms: string): Date => new Date(`2026-10-02T${hms}`)
const ids = (es: CalEvent[]): string[] => es.map((e) => e.id)

describe('dueReminders', () => {
  it('fires within the lead time before the start', () => {
    const e = [ev('x')]
    expect(ids(dueReminders(e, at('09:57:59'), 2, new Set()))).toEqual([])
    expect(ids(dueReminders(e, at('09:58:00'), 2, new Set()))).toEqual(['x'])
    expect(ids(dueReminders(e, at('09:59:30'), 2, new Set()))).toEqual(['x'])
  })
  it('still fires just after the start, not later', () => {
    const e = [ev('x')]
    expect(ids(dueReminders(e, at('10:00:30'), 2, new Set()))).toEqual(['x'])
    expect(ids(dueReminders(e, at('10:01:00'), 2, new Set()))).toEqual([])
  })
  it('skips all-day, declined and already reminded events, and does nothing when off', () => {
    const e = [ev('day', { allDay: true, start: '2026-10-02', end: '2026-10-03' }), ev('no', { myStatus: 'declined' }), ev('done'), ev('ok')]
    const sent = new Set([reminderKey(e[2])])
    expect(ids(dueReminders(e, at('09:59:00'), 5, sent))).toEqual(['ok'])
    expect(dueReminders(e, at('09:59:00'), 0, new Set())).toEqual([])
  })
  it('reminds again when the event moves', () => {
    const sent = new Set([reminderKey(ev('x'))])
    const moved = ev('x', { start: '2026-10-02T10:02:00', end: '2026-10-02T10:30:00' })
    expect(ids(dueReminders([moved], at('10:00:30'), 2, sent))).toEqual(['x'])
  })
})

describe('reminderText', () => {
  it('shows when, time and place, with the call link', () => {
    const e = ev('Standup', { location: 'Room 3 / https://zoom.us/j/1' })
    expect(reminderText(e, at('09:58:00'))).toEqual({
      title: 'Standup',
      body: 'in 2 min · 10:00–10:30 · Room 3',
      join: { url: 'https://zoom.us/j/1', label: 'Join Zoom' }
    })
  })
  it('finds the call in the description and speaks Ukrainian', () => {
    const e = ev('', { description: '<a href="https://teams.microsoft.com/l/meetup-join/1">Join</a>' })
    const r = reminderText(e, at('10:00:10'), 'uk')
    expect(r.title).toBe('Без назви')
    expect(r.body).toBe('починається зараз · 10:00–10:30')
    expect(r.join).toEqual({ url: 'https://teams.microsoft.com/l/meetup-join/1', label: 'Приєднатися до Teams' })
  })
  it('labels a custom link "Join" and has no button without a link', () => {
    expect(reminderText(ev('x', { location: 'https://calls.acme.dev/r/1' }), at('09:59:00')).join?.label).toBe('Join')
    expect(reminderText(ev('x', { location: 'Kyiv' }), at('09:59:00')).join).toBeUndefined()
  })
})

describe('isReminderMin', () => {
  it('accepts only the offered choices', () => {
    expect([0, 2, 15].every(isReminderMin)).toBe(true)
    expect([3, -1, '2', undefined].some(isReminderMin)).toBe(false)
  })
})

describe('reminded keys', () => {
  const now = at('10:00:00').getTime()
  const hourAgo = now - 60 * 60_000
  it('loads stored keys, dropping junk and ones older than an hour', () => {
    const stored = { fresh: now - 60_000, edge: hourAgo, old: hourAgo - 1, bad: 'x', nan: null }
    expect(loadReminded(stored, now)).toEqual(new Map([['fresh', now - 60_000], ['edge', hourAgo]]))
  })
  it('loads nothing from a missing or broken file', () => {
    expect(loadReminded(undefined, now)).toEqual(new Map())
    expect(loadReminded(null, now)).toEqual(new Map())
    expect(loadReminded([1, 2], now)).toEqual(new Map())
  })
  it('prunes keys older than an hour and says whether any went', () => {
    const sent = new Map([['a', now], ['edge', hourAgo], ['b', hourAgo - 1]])
    expect(pruneReminded(sent, now)).toBe(true)
    expect([...sent.keys()]).toEqual(['a', 'edge'])
    expect(pruneReminded(sent, now)).toBe(false)
  })
})

describe('splitReminders', () => {
  const es = [
    ev('meet', { conferenceUrl: 'https://meet.google.com/abc-defg-hij' }),
    ev('zoom', { location: 'https://zoom.us/j/1' }),
    ev('teams', { location: 'https://teams.microsoft.com/l/meetup-join/x' }),
    ev('map', { location: 'https://maps.google.com/?q=Kyiv' }),
    ev('link', { location: 'https://example.com/agenda' }),
    ev('none', { location: 'Room 3' })
  ]
  it('puts call-link events on the full-screen reminder when it is on', () => {
    const { fullscreen, banner } = splitReminders(es, true)
    expect(ids(fullscreen)).toEqual(['meet', 'zoom', 'teams'])
    expect(ids(banner)).toEqual(['map', 'link', 'none'])
  })
  it('sends everything as a banner when it is off', () => {
    expect(splitReminders(es, false)).toEqual({ fullscreen: [], banner: es })
  })
})
