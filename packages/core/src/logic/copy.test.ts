import { describe, expect, it } from 'vitest'
import type { CalEvent } from '../shared/types'
import { copyInput } from './copy'

const ev = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: 'e1',
  accountId: 'work',
  calendarId: 'w',
  title: 'Standup',
  start: new Date(2026, 8, 24, 9, 30).toISOString(),
  end: new Date(2026, 8, 24, 10, 15).toISOString(),
  allDay: false,
  location: 'Room 1',
  attendees: [
    { email: 'me@work.example', self: true, organizer: true, status: 'accepted' },
    { email: 'ann@work.example', status: 'needsAction' }
  ],
  recurringEventId: 'series',
  ...over
})

describe('copyInput', () => {
  it('copies contents at the same time, without the series or guests', () => {
    const e = ev()
    expect(copyInput(e)).toEqual({
      accountId: 'work',
      calendarId: 'w',
      title: 'Standup',
      start: e.start,
      end: e.end,
      allDay: false,
      location: 'Room 1',
      description: undefined
    })
  })

  it('keeps guests other than the owner only when asked (undo)', () => {
    expect(copyInput(ev(), undefined, { guests: true }).attendees).toEqual(['ann@work.example'])
  })

  it('moves a timed event to a timed slot, keeping its length', () => {
    const at = new Date(2026, 8, 25, 14, 0).toISOString()
    const r = copyInput(ev(), { start: at, allDay: false })
    expect(r).toMatchObject({ allDay: false, start: at, end: new Date(2026, 8, 25, 14, 45).toISOString() })
  })

  it('moves a timed event to a day, keeping its clock time', () => {
    const r = copyInput(ev(), { start: '2026-10-02', allDay: true })
    expect(r).toMatchObject({
      allDay: false,
      start: new Date(2026, 9, 2, 9, 30).toISOString(),
      end: new Date(2026, 9, 2, 10, 15).toISOString()
    })
  })

  it('keeps an all-day event all-day, with as many days', () => {
    const e = ev({ allDay: true, start: '2026-09-24', end: '2026-09-26' })
    expect(copyInput(e, { start: '2026-10-01', allDay: true })).toMatchObject({ allDay: true, start: '2026-10-01', end: '2026-10-03' })
    const timed = new Date(2026, 9, 5, 23, 0).toISOString()
    expect(copyInput(e, { start: timed, allDay: false })).toMatchObject({ allDay: true, start: '2026-10-05', end: '2026-10-07' })
  })
})
