import { afterEach, describe, expect, it } from 'vitest'
import type { Account, CalEvent } from '@mysticals/core/shared/types'
import { createTestClient, renderWith, type Rendered } from '../test/harness'
import { StatusLine } from './StatusLine'

let t: Rendered
afterEach(() => t?.unmount())

const now = new Date()
const at = (min: number): string => new Date(now.getTime() + min * 60_000).toISOString()
const ev = (id: string, title: string, start: number, end: number): CalEvent =>
  ({ id, title, accountId: 'work', calendarId: 'work-main', start: at(start), end: at(end), allDay: false, attendees: [] })

const nav = { view: 'agenda' as const, date: now }

describe('StatusLine', () => {
  it('shows now/next, invite count, failed accounts and the message', async () => {
    const client = createTestClient()
    client.events.list.mockResolvedValue([
      ev('a', 'Standup', -5, 10),
      ev('b', 'Review', 25, 60),
      { ...ev('c', 'Offsite', 60 * 30, 60 * 31), myStatus: 'needsAction' }
    ])
    const accounts: Account[] = [{ id: 'work', kind: 'caldav', label: 'Work', email: 'w@x', color: '#fff', error: 'offline' }]
    client.accounts.list.mockResolvedValue(accounts)
    t = renderWith(<StatusLine nav={nav} events={[]} now={now} message="Synced" width={200} />, client)
    const f = await t.waitFor('sync failed')
    expect(f).toContain('now Standup')
    expect(f).toContain('next Review in 25m')
    expect(f).toContain('1 invite (i)')
    expect(f).toContain('⚠ Work sync failed')
    expect(f).toContain('Synced')
    expect(f).toContain('? help')
  })

  it('stays on two rows (info, actions) when narrow', async () => {
    t = renderWith(<StatusLine nav={nav} events={[]} now={now} message={'x'.repeat(100)} width={30} />)
    const f = await t.waitFor('x')
    expect(f.split('\n')).toHaveLength(2)
    expect(f.split('\n')[1]).toMatch(/^n new/)
    for (const l of f.split('\n')) expect(l.length).toBeLessThanOrEqual(30)
  })
})
