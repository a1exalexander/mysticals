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
})
