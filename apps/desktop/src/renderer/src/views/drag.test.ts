import { describe, expect, it } from 'vitest'
import { moveRange, resizeEnd, shiftDays, snap } from './drag'

describe('drag math', () => {
  it('snaps to 15 minutes', () => {
    expect(snap(7)).toBe(0)
    expect(snap(8)).toBe(15)
    expect(snap(-22)).toBe(-15)
  })

  it('moves keeping the duration inside the day', () => {
    expect(moveRange(600, 660, 38)).toEqual({ start: 645, end: 705 })
    expect(moveRange(600, 660, -900)).toEqual({ start: 0, end: 60 })
    expect(moveRange(1380, 1440, 120)).toEqual({ start: 1380, end: 1440 })
  })

  it('resizes to at least one step, at most midnight', () => {
    expect(resizeEnd(600, 700)).toBe(705)
    expect(resizeEnd(600, 560)).toBe(615)
    expect(resizeEnd(600, 2000)).toBe(1440)
  })

  it('shifts by days keeping local times, all-day stays date-only', () => {
    expect(shiftDays({ start: '2026-09-23', end: '2026-09-24', allDay: true }, 2)).toEqual({ start: '2026-09-25', end: '2026-09-26' })
    const s = new Date(2026, 8, 23, 10, 30)
    const moved = shiftDays({ start: s.toISOString(), end: new Date(2026, 8, 23, 11).toISOString(), allDay: false }, -1)
    expect(new Date(moved.start)).toEqual(new Date(2026, 8, 22, 10, 30))
    expect(new Date(moved.end)).toEqual(new Date(2026, 8, 22, 11))
  })
})
