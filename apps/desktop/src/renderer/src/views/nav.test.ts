import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// nav.ts reads the clock at import, so each test pins the time before a fresh import.
const load = async (at: string): Promise<typeof import('./nav')> => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(at))
  vi.resetModules()
  return import('./nav')
}

describe('rollover', () => {
  // Cold first import (react, date-fns) can exceed the 5s test timeout on CI runners; pay it once here.
  beforeAll(() => import('./nav'), 30_000)
  afterEach(() => vi.useRealTimers())

  it('moves a view on today to the new day', async () => {
    const { nav, rollover } = await load('2026-10-06T23:30:00')
    vi.setSystemTime(new Date('2026-10-07T08:00:00'))
    rollover()
    expect(nav.get().date.getDate()).toBe(7)
  })

  it('leaves a view stepped away to another date', async () => {
    const { nav, rollover } = await load('2026-10-06T23:30:00')
    nav.set({ date: new Date('2026-10-20T12:00:00') })
    vi.setSystemTime(new Date('2026-10-07T08:00:00'))
    rollover()
    expect(nav.get().date.getDate()).toBe(20)
  })

  it('does nothing on the same day', async () => {
    const { nav, rollover } = await load('2026-10-06T09:00:00')
    const before = nav.get()
    vi.setSystemTime(new Date('2026-10-06T23:59:00'))
    rollover()
    expect(nav.get()).toBe(before)
  })
})
