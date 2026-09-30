import { describe, it, expect } from 'vitest'
import { createMockApi } from './mockApi'

describe('mock api isolation', () => {
  it('rejects writes to a calendar of another account', async () => {
    const api = createMockApi(() => {})
    await expect(
      api.events.create({ accountId: 'personal', calendarId: 'work-main', title: 'x', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z', allDay: false })
    ).rejects.toThrow()
  })
  it('creates event only in chosen account with its own organizer', async () => {
    const api = createMockApi(() => {})
    const ev = await api.events.create({ accountId: 'work', calendarId: 'work-main', title: 'x', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z', allDay: false })
    expect(ev.accountId).toBe('work')
    expect(ev.organizer?.email).toBe('me@work.example')
  })

  it('events.list keeps hidden calendars; calendars.list reports visibility', async () => {
    const api = createMockApi(() => {})
    const range = { start: new Date(Date.now() - 864e5).toISOString(), end: new Date(Date.now() + 864e5).toISOString() }
    const gym = async (): Promise<number> => (await api.events.list(range)).filter((e) => e.title === 'Gym').length
    await api.calendars.setVisible('personal', 'p-main', false)
    expect(await gym()).toBe(1)
    expect((await api.calendars.list()).find((c) => c.id === 'p-main')?.visible).toBe(false)
  })

  it('deletes recurring instances by scope', async () => {
    const api = createMockApi(() => {})
    const range = { start: new Date(Date.now() - 7 * 864e5).toISOString(), end: new Date(Date.now() + 7 * 864e5).toISOString() }
    const runs = async () => (await api.events.list(range)).filter((e) => e.title === 'Morning run')
    expect(await runs()).toHaveLength(7)
    await api.events.delete((await runs())[6], 'one')
    expect(await runs()).toHaveLength(6)
    await api.events.delete((await runs())[3], 'following')
    expect(await runs()).toHaveLength(3)
    await api.events.delete((await runs())[1], 'all')
    expect(await runs()).toHaveLength(0)
  })

  it('creates repeating events and changes or stops their rule', async () => {
    const api = createMockApi(() => {})
    const range = { start: '2026-01-01T00:00:00Z', end: '2026-03-01T00:00:00Z' }
    const gyms = async () => (await api.events.list(range)).filter((e) => e.title === 'Gym weekly').map((e) => e.start.slice(0, 10)).sort()
    const first = await api.events.create({ accountId: 'work', calendarId: 'work-main', title: 'Gym weekly', start: '2026-01-05T18:00:00.000Z', end: '2026-01-05T19:00:00.000Z', allDay: false, recurrence: { freq: 'weekly', byDay: ['MO', 'TH'], count: 4 } })
    expect(await gyms()).toEqual(['2026-01-05', '2026-01-08', '2026-01-12', '2026-01-15'])
    expect(await api.events.recurrence(first)).toEqual({ freq: 'weekly', byDay: ['MO', 'TH'], count: 4 })
    const [, second] = (await api.events.list(range)).filter((e) => e.title === 'Gym weekly').sort((a, b) => a.start.localeCompare(b.start))
    await api.events.update({ ...second, recurrence: { freq: 'daily', count: 3 } }, 'following')
    expect(await gyms()).toEqual(['2026-01-05', '2026-01-08', '2026-01-09', '2026-01-10'])
    await api.events.update({ ...first, recurrence: null }, 'all')
    expect(await gyms()).toEqual(['2026-01-05', '2026-01-08', '2026-01-09', '2026-01-10'])
    const single = await api.events.create({ accountId: 'work', calendarId: 'work-main', title: 'Once', start: '2026-01-06', end: '2026-01-07', allDay: true })
    expect(await api.events.recurrence(single)).toBeNull()
    await api.events.update({ ...single, recurrence: { freq: 'monthly', count: 2 } })
    expect((await api.events.list(range)).filter((e) => e.title === 'Once').map((e) => e.start)).toEqual(['2026-01-06', '2026-02-06'])
  })

  it('edits recurring instances by scope', async () => {
    const api = createMockApi(() => {})
    const range = { start: new Date(Date.now() - 7 * 864e5).toISOString(), end: new Date(Date.now() + 7 * 864e5).toISOString() }
    const runs = async () => (await api.events.list(range)).filter((e) => e.recurringEventId === 'run-series').sort((a, b) => a.start.localeCompare(b.start))
    const titles = async () => (await runs()).map((e) => e.title)
    await api.events.update({ ...(await runs())[1], title: 'Jog' }, 'one')
    expect(await titles()).toEqual(['Morning run', 'Jog', 'Morning run', 'Morning run', 'Morning run', 'Morning run', 'Morning run'])
    const fourth = (await runs())[3]
    const later = (iso: string) => new Date(Date.parse(iso) + 3600_000).toISOString()
    await api.events.update({ ...fourth, title: 'Long run', start: later(fourth.start), end: later(fourth.end) }, 'following')
    const after = await runs()
    expect(after.map((e) => e.title)).toEqual(['Morning run', 'Jog', 'Morning run', 'Long run', 'Long run', 'Long run', 'Long run'])
    expect(new Date(after[6].start).getHours()).toBe(8)
    expect(new Date(after[0].start).getHours()).toBe(7)
    await api.events.update({ ...after[0], title: 'Run' }, 'all')
    expect(new Set(await titles())).toEqual(new Set(['Run']))
  })
})
