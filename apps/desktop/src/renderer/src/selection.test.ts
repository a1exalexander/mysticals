import { describe, expect, it } from 'vitest'
import type { CalEvent } from '@shared/types'
import { bulkTargets, selection } from './selection'

const ev = (id: string, start: string, recurringEventId?: string): CalEvent =>
  ({ id, accountId: 'a', calendarId: 'c', title: id, start, end: start, allDay: false, attendees: [], recurringEventId }) as CalEvent

describe('bulkTargets', () => {
  const single = ev('s', '2026-01-03T09:00:00Z')
  const late = ev('r2', '2026-01-09T09:00:00Z', 'series')
  const early = ev('r1', '2026-01-02T09:00:00Z', 'series')
  const other = ev('o1', '2026-01-05T09:00:00Z', 'other')

  it('"this event" runs on every picked one', () => {
    expect(bulkTargets([single, late, early, other], 'one')).toEqual([single, late, early, other])
  })

  it('a series-wide scope runs once per series, from its earliest picked occurrence', () => {
    expect(bulkTargets([single, late, early, other], 'all')).toEqual([early, single, other])
    expect(bulkTargets([late, early], 'following')).toEqual([early])
  })

  it('a series in another calendar is its own', () => {
    expect(bulkTargets([early, { ...late, calendarId: 'c2' }], 'all')).toHaveLength(2)
  })
})

describe('selection', () => {
  it('toggles, clears and marks busy until the action settles', async () => {
    const a = ev('a', '2026-01-01T09:00:00Z')
    selection.toggle(a)
    expect(selection.has(a)).toBe(true)
    selection.toggle(a)
    expect(selection.size()).toBe(0)
    selection.toggle(a)
    selection.clear()
    expect(selection.size()).toBe(0)

    let done!: () => void
    const p = selection.track(a, new Promise<void>((r) => (done = r)))
    expect(selection.isBusy(a)).toBe(true)
    done()
    await p
    expect(selection.isBusy(a)).toBe(false)
    await selection.track(a, Promise.reject(new Error('x'))).catch(() => {})
    expect(selection.isBusy(a)).toBe(false)
  })
})
