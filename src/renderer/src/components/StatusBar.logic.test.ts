import { describe, expect, it } from 'vitest'
import type { CalEvent } from '@shared/types'
import { pickNowNext, startsLabel } from './StatusBar.logic'

const now = new Date('2026-09-23T12:00:00Z')
const ev = (id: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id, accountId: 'a', calendarId: 'c', title: id, attendees: [], allDay: false,
  start: `2026-09-23T${start}:00Z`, end: `2026-09-23T${end}:00Z`, ...extra
})

describe('pickNowNext', () => {
  it('returns empty for no events', () => {
    expect(pickNowNext([], now)).toEqual({ current: [], next: undefined })
  })

  it('includes an event starting exactly now, excludes one ending exactly now', () => {
    const r = pickNowNext([ev('ended', '11:00', '12:00'), ev('starts', '12:00', '13:00')], now)
    expect(r.current.map((e) => e.id)).toEqual(['starts'])
    expect(r.next).toBeUndefined()
  })

  it('sorts overlapping current events by start and picks the earliest next', () => {
    const r = pickNowNext(
      [ev('late', '15:00', '16:00'), ev('b', '11:30', '12:30'), ev('soon', '12:10', '12:20'), ev('a', '11:00', '13:00')],
      now
    )
    expect(r.current.map((e) => e.id)).toEqual(['a', 'b'])
    expect(r.next?.id).toBe('soon')
  })

  it('skips all-day and declined events', () => {
    const r = pickNowNext(
      [
        ev('allday', '00:00', '23:59', { allDay: true }),
        ev('declined', '11:00', '13:00', { myStatus: 'declined' }),
        ev('declinedNext', '12:30', '13:00', { myStatus: 'declined' })
      ],
      now
    )
    expect(r).toEqual({ current: [], next: undefined })
  })
})

describe('startsLabel', () => {
  it('uses relative minutes within the hour, clock time beyond', () => {
    expect(startsLabel('2026-09-23T12:25:00Z', now)).toBe('in 25m')
    expect(startsLabel('2026-09-23T13:00:00Z', now)).toBe('in 60m')
    expect(startsLabel('2026-09-23T14:00:00Z', now)).toMatch(/^at \d\d:00$/)
  })
})
