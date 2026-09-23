import { describe, expect, it } from 'vitest'
import type { CalEvent } from '@shared/types'
import {
  dragRange,
  eventsOnDay,
  isPast,
  layoutDay,
  monthGrid,
  packColumns,
  rangeLabel,
  shiftDate,
  slotAt,
  viewDays,
  viewRange
} from './layout'

const ev = (id: string, start: string, end: string, allDay = false): CalEvent => ({
  id, accountId: 'a', calendarId: 'c', title: id, start, end, allDay, attendees: []
})
const at = (h: number, m = 0): string => new Date(2026, 8, 23, h, m).toISOString()
const day = new Date(2026, 8, 23)

describe('packColumns', () => {
  it('places overlapping items side by side and keeps separate clusters full width', () => {
    const r = packColumns([
      { item: 'a', start: 60, end: 180 },
      { item: 'b', start: 120, end: 240 },
      { item: 'c', start: 200, end: 260 }, // overlaps b only -> reuses a's column
      { item: 'd', start: 300, end: 360 } // own cluster
    ])
    const by = Object.fromEntries(r.map((p) => [p.item, [p.col, p.cols]]))
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] })
  })

  it('treats short items as minDur tall', () => {
    const r = packColumns([
      { item: 'a', start: 0, end: 5 },
      { item: 'b', start: 10, end: 20 }
    ], 20)
    expect(r.map((p) => p.cols)).toEqual([2, 2])
  })
})

describe('layoutDay', () => {
  it('clips events crossing midnight and ignores all-day', () => {
    const r = layoutDay([
      ev('late', new Date(2026, 8, 22, 22).toISOString(), at(2)),
      ev('ad', '2026-09-23', '2026-09-24', true)
    ], day)
    expect(r).toHaveLength(1)
    expect([r[0].start, r[0].end]).toEqual([0, 120])
  })
})

describe('eventsOnDay', () => {
  it('puts all-day first and handles all-day with end == start', () => {
    const r = eventsOnDay([
      ev('t', at(9), at(10)),
      ev('h', '2026-09-23', '2026-09-23', true),
      ev('next', '2026-09-24', '2026-09-25', true)
    ], day)
    expect(r.map((e) => e.id)).toEqual(['h', 't'])
  })
})

describe('monthGrid', () => {
  it('is 42 days starting on the Monday on/before the 1st', () => {
    const g = monthGrid(new Date(2026, 8, 15))
    expect(g).toHaveLength(42)
    expect(g[0]).toEqual(new Date(2026, 7, 31)) // Mon Aug 31
    expect(viewRange('month', day).start).toBe(g[0].toISOString())
  })
})

describe('3day view', () => {
  it('covers 3 days from the selected date and pages by 3', () => {
    const days = viewDays('3day', new Date(2026, 8, 30, 15))
    expect(days).toEqual([new Date(2026, 8, 30), new Date(2026, 9, 1), new Date(2026, 9, 2)])
    expect(viewRange('3day', days[0])).toEqual({
      start: days[0].toISOString(),
      end: new Date(2026, 9, 3).toISOString()
    })
    expect(shiftDate('3day', day, 1)).toEqual(new Date(2026, 8, 26))
    expect(shiftDate('3day', day, -1)).toEqual(new Date(2026, 8, 20))
  })
  it('labels ranges across month and year', () => {
    expect(rangeLabel(new Date(2026, 8, 23), new Date(2026, 8, 25))).toBe('23 – 25 Sep 2026')
    expect(rangeLabel(new Date(2026, 8, 30), new Date(2026, 9, 2))).toBe('30 Sep – 2 Oct 2026')
    expect(rangeLabel(new Date(2026, 11, 31), new Date(2027, 0, 2))).toBe('31 Dec 2026 – 2 Jan 2027')
  })
})

describe('slots', () => {
  it('snaps to 15 minutes and drags both directions', () => {
    expect(slotAt(37)).toBe(30)
    expect(slotAt(-5)).toBe(0)
    expect(slotAt(2000)).toBe(1425)
    expect(dragRange(90, 30)).toEqual({ start: 30, end: 105 })
  })
})

describe('isPast', () => {
  const now = new Date(2026, 8, 23, 12)
  it('timed: ended is past, ongoing and future are not', () => {
    expect(isPast(ev('a', at(9), at(12)), now)).toBe(true)
    expect(isPast(ev('b', at(11), at(13)), now)).toBe(false)
    expect(isPast(ev('c', at(14), at(15)), now)).toBe(false)
  })
  it('all-day: yesterday is past, today is not', () => {
    expect(isPast(ev('y', '2026-09-22', '2026-09-23', true), now)).toBe(true)
    expect(isPast(ev('t', '2026-09-23', '2026-09-24', true), now)).toBe(false)
    expect(isPast(ev('t0', '2026-09-23', '2026-09-23', true), now)).toBe(false)
  })
  it('multi-day spanning now is not past', () => {
    expect(isPast(ev('m', new Date(2026, 8, 21, 9).toISOString(), new Date(2026, 8, 25, 9).toISOString()), now)).toBe(false)
    expect(isPast(ev('ma', '2026-09-21', '2026-09-26', true), now)).toBe(false)
  })
})
