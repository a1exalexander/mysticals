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
})
