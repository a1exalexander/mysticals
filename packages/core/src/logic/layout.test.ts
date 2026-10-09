import { describe, expect, it } from 'vitest'
import type { CalEvent } from '../shared/types'
import {
  columnsFit,
  dragRange,
  eventKey,
  eventsOnDay,
  fitColumns,
  isPast,
  layoutDay,
  layoutDayLong,
  monthGrid,
  monthShown,
  packColumns,
  type Placed,
  rangeLabel,
  shiftDate,
  slotAt,
  snapLongHours,
  viewDays,
  viewRange,
  weekLabel
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

describe('packColumns span', () => {
  it('widens an item over columns free for its whole span', () => {
    const r = packColumns([
      { item: 'long', start: 0, end: 600 },
      { item: 'a', start: 60, end: 120 },
      { item: 'b', start: 90, end: 150 },
      { item: 'late', start: 300, end: 360 } // only 'long' beside it: takes both free columns
    ])
    const by = Object.fromEntries(r.map((p) => [p.item, [p.col, p.span, p.cols]]))
    expect(by).toEqual({ long: [0, 1, 3], a: [1, 1, 3], b: [2, 1, 3], late: [1, 2, 3] })
  })

  it('keeps identical stacks at one column each', () => {
    const r = packColumns([0, 1, 2].map((i) => ({ item: i, start: 600, end: 1380 })))
    expect(r.map((p) => p.span)).toEqual([1, 1, 1])
  })
})

describe('layoutDayLong', () => {
  const day6 = [ev('n1', at(10), at(23)), ev('n2', at(10), at(23)), ev('n3', at(10), at(22)), ev('quiz', at(18), at(21))]

  it('rails: long events leave the lanes, short ones sit beside them', () => {
    const r = layoutDayLong(day6, day, 0, { mode: 'rails', hours: 6 })
    expect(r.rails.map((p) => [p.item.id, p.col, p.cols])).toEqual([['n1', 0, 3], ['n2', 1, 3], ['n3', 2, 3]])
    expect(r.timed.map((p) => [p.item.id, p.cols, p.inset])).toEqual([['quiz', 1, 3]])
    expect(r.allDay).toEqual([])
    expect(r.busy).toEqual([{ start: 600, end: 1380 }])
  })

  it('counts an event as long only when longer than the threshold', () => {
    const r = layoutDayLong([ev('six', at(9), at(15)), ev('more', at(9), at(15, 1))], day, 0, { mode: 'rails', hours: 6 })
    expect(r.timed.map((p) => [p.item.id, p.inset])).toEqual([['six', 1]])
    expect(r.rails.map((p) => p.item.id)).toEqual(['more'])
  })

  it('allday: long events go to the all-day row, the grid keeps the busy span', () => {
    const r = layoutDayLong(day6, day, 0, { mode: 'allday', hours: 6 })
    expect(r.allDay.map((x) => [x.item.id, x.start, x.end])).toEqual([['n1', 600, 1380], ['n2', 600, 1380], ['n3', 600, 1320]])
    expect(r.rails).toEqual([])
    expect(r.timed.map((p) => [p.item.id, p.cols, p.inset])).toEqual([['quiz', 1, 0]])
    expect(r.busy).toEqual([{ start: 600, end: 1380 }])
  })

  it('cascade: every block full width, indented past the ones it overlaps, longer first', () => {
    const r = layoutDayLong([...day6, ev('later', at(23), at(23, 30))], day, 0, { mode: 'cascade', hours: 6 })
    expect(r.timed.map((p) => [p.item.id, p.level, p.cols])).toEqual([
      ['n1', 0, 1], ['n2', 1, 1], ['n3', 2, 1], ['quiz', 3, 1], ['later', 0, 1]
    ])
    expect(r.rails).toEqual([])
    expect(r.busy).toEqual([])
  })

  it('expand: everything stays a block', () => {
    const r = layoutDayLong(day6, day, 0, { mode: 'expand', hours: 6 })
    expect(r.timed).toHaveLength(4)
    expect(r.rails).toEqual([])
    expect(r.busy).toEqual([])
  })

  it('judges an event by its part of the day', () => {
    const overnight = ev('night', new Date(2026, 8, 22, 22).toISOString(), at(4))
    expect(layoutDayLong([overnight], day, 0, { mode: 'rails', hours: 6 }).timed).toHaveLength(1)
  })

  it('merges separate long spans into busy stretches', () => {
    const r = layoutDayLong(
      [ev('a', at(0), at(8)), ev('b', at(7), at(15)), ev('c', at(15, 30), at(23))],
      day, 0, { mode: 'allday', hours: 6 }
    )
    expect(r.busy).toEqual([{ start: 0, end: 900 }, { start: 930, end: 1380 }])
  })

  it('takes a half-hour threshold', () => {
    const r = layoutDayLong([ev('six', at(9), at(15, 30)), ev('more', at(9), at(15, 31))], day, 0, { mode: 'rails', hours: 6.5 })
    expect(r.rails.map((p) => p.item.id)).toEqual(['more'])
  })
})

describe('snapLongHours', () => {
  it('rounds to half hours within 1–12', () => {
    expect(snapLongHours(6.3)).toBe(6.5)
    expect(snapLongHours(8)).toBe(8)
    expect(snapLongHours(0)).toBe(1)
    expect(snapLongHours(99)).toBe(12)
  })

  it('falls back to the default on garbage', () => {
    expect(snapLongHours(NaN)).toBe(6)
    expect(snapLongHours('8')).toBe(6)
    expect(snapLongHours(undefined)).toBe(6)
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

describe('columnsFit', () => {
  it('fits 48px columns right of the rails, at least two', () => {
    expect(columnsFit(127.6, 0)).toBe(2) // a 1200px window's week column
    expect(columnsFit(200, 0)).toBe(4)
    expect(columnsFit(200, 2)).toBe(3)
    expect(columnsFit(60, 0)).toBe(2)
    expect(columnsFit(Infinity, 1)).toBe(Infinity)
  })
})

describe('fitColumns', () => {
  const lanes = <T>(placed: Placed<T>[]): (Placed<T> & { inset: number })[] => placed.map((p) => ({ ...p, inset: 0 }))
  const four = lanes(packColumns(['a', 'b', 'c', 'd'].map((item) => ({ item, start: 600, end: 660 }))))

  it('leaves clusters that fit alone', () => {
    expect(fitColumns(four, 192)).toEqual({ shown: four, more: [] })
  })

  it('keeps the columns before the last that fits and folds the rest into one "+N" per overlapping run', () => {
    const r = fitColumns([...four, ...lanes(packColumns([{ item: 'late', start: 900, end: 960 }]))], 144)
    expect(r.shown.map((p) => [p.item, p.col, p.cols, p.span])).toEqual([['a', 0, 3, 1], ['b', 1, 3, 1], ['late', 0, 1, 1]])
    expect(r.more.map((m) => [m.start, m.end, m.items.map((p) => p.item), m.cols])).toEqual([[600, 660, ['c', 'd'], 3]])
  })

  it('stops a widened block short of the "+N" column', () => {
    const r = fitColumns(lanes(packColumns([
      { item: 'long', start: 0, end: 600 },
      { item: 'a', start: 60, end: 120 },
      { item: 'b', start: 90, end: 150 },
      { item: 'c', start: 100, end: 160 },
      { item: 'late', start: 300, end: 360 } // spans columns 1-3 when all four show
    ])), 144)
    expect(r.shown.map((p) => [p.item, p.col, p.cols, p.span])).toEqual([['long', 0, 3, 1], ['a', 1, 3, 1], ['late', 1, 3, 1]])
    expect(r.more.map((m) => m.items.map((p) => p.item))).toEqual([['b', 'c']])
  })

  it('shows a lone block past the last column in it instead of a "+1"', () => {
    // A 1200px window's week column fits two: A 9–11, B 9–10, C 9:30–10:30, D 10:30–11.
    const r = fitColumns(lanes(packColumns([
      { item: 'A', start: 540, end: 660 },
      { item: 'B', start: 540, end: 600 },
      { item: 'C', start: 570, end: 630 },
      { item: 'D', start: 630, end: 660 }
    ])), 127.6)
    expect(r.shown.map((p) => [p.item, p.col, p.cols, p.span])).toEqual([['A', 0, 2, 1], ['D', 1, 2, 1]])
    expect(r.more.map((m) => [m.start, m.end, m.items.map((p) => p.item)])).toEqual([[540, 630, ['B', 'C']]])
  })

  it('merges hidden blocks that overlap only through minDur', () => {
    const r = fitColumns(lanes(packColumns([0, 1, 2].map((i) => ({ item: i, start: 600 + i * 5, end: 605 + i * 5 })), 20)), 96, 20)
    expect(r.more).toEqual([{ start: 605, end: 630, items: [expect.objectContaining({ item: 1 }), expect.objectContaining({ item: 2 })], cols: 2, inset: 0 }])
  })

  it('fits each cluster right of its own rails, and its "+N" right of the deepest', () => {
    // A rail until 9:30 beside m1 only; the afternoon has none.
    const l = layoutDayLong([
      ev('rail', at(3), at(9, 30)),
      ev('m1', at(9), at(10)),
      ev('m2', at(9, 40), at(10, 40)),
      ev('m3', at(9, 45), at(10, 45)),
      ...['a1', 'a2', 'a3'].map((id) => ev(id, at(15), at(16)))
    ], day, 0, { mode: 'rails', hours: 6 })
    const r = fitColumns(l.timed, 148)
    expect(r.shown.map((p) => [p.item.id, p.cols, p.inset])).toEqual([['m1', 2, 1], ['a1', 3, 0], ['a2', 3, 0], ['a3', 3, 0]])
    expect(r.more.map((m) => [m.items.map((p) => p.item.id), m.cols, m.inset])).toEqual([[['m2', 'm3'], 2, 1]])
  })
})

describe('monthShown', () => {
  it('lists every event that fits, else the rows above "+N more", at least one', () => {
    expect(monthShown(115, 4)).toBe(4) // 1200x800 window
    expect(monthShown(115, 5)).toBe(3)
    expect(monthShown(145, 5)).toBe(5) // full screen
    expect(monthShown(145, 9)).toBe(4)
    expect(monthShown(82, 5)).toBe(1) // minimum window
    expect(monthShown(20, 3)).toBe(1)
    expect(monthShown(115, 0)).toBe(0)
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
    expect(rangeLabel(new Date(2026, 8, 30), new Date(2026, 9, 2), 'uk')).toBe('30 верес. – 2 жовт. 2026')
  })
})

describe('weekLabel', () => {
  it('names the month, or both months and years, of the days shown', () => {
    expect(weekLabel(new Date(2026, 8, 7), new Date(2026, 8, 13))).toEqual({ title: 'September', year: '2026' })
    expect(weekLabel(new Date(2026, 8, 28), new Date(2026, 9, 4))).toEqual({ title: 'Sep – Oct', year: '2026' })
    expect(weekLabel(new Date(2026, 11, 28), new Date(2027, 0, 3))).toEqual({ title: 'Dec – Jan', year: '2026 – 2027' })
  })
  it('localises the month names', () => {
    expect(weekLabel(new Date(2026, 8, 7), new Date(2026, 8, 13), 'uk')).toEqual({ title: 'вересень', year: '2026' })
    expect(weekLabel(new Date(2026, 8, 28), new Date(2026, 9, 4), 'uk')).toEqual({ title: 'верес. – жовт.', year: '2026' })
    expect(weekLabel(new Date(2026, 11, 28), new Date(2027, 0, 3), 'uk')).toEqual({ title: 'груд. – січ.', year: '2026 – 2027' })
  })
})

describe('eventKey', () => {
  it('tells apart copies of one meeting in two accounts or two calendars', () => {
    const work = ev('m1', at(9), at(10))
    const personal = { ...work, accountId: 'b' }
    const shared = { ...work, calendarId: 'team' }
    expect(new Set([work, personal, shared].map(eventKey)).size).toBe(3)
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
