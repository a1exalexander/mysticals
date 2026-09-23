import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '@multicals/core/shared/types'
import { renderApp, renderWith, type Rendered } from '../../test/harness'
import type { ClientApi } from '../../client'
import { ApiContext, eventKey } from '../hooks'
import { Agenda } from './Agenda'

let t: Rendered
afterEach(() => t?.unmount())
// rerender replaces the root, so re-wrap in the harness's ApiContext
const rerender = (node: React.ReactElement): void =>
  t.rerender(<ApiContext.Provider value={t.client as unknown as ClientApi}>{node}</ApiContext.Provider>)

const at = (d: number, h: number, m = 0): string => new Date(2026, 8, d, h, m).toISOString()
const ev = (id: string, p: Partial<CalEvent>): CalEvent => ({
  id, accountId: 'work', calendarId: 'work-main', title: id, start: at(23, 9), end: at(23, 10), allDay: false, attendees: [], ...p
})
const now = new Date(2026, 8, 23, 12)
const view = (events: CalEvent[], p: { selectedKey?: string; height?: number; width?: number } = {}) => (
  <Agenda events={events} date={new Date(2026, 8, 23)} now={now} onSelect={vi.fn()} onOpen={vi.fn()} width={p.width ?? 60}
    height={p.height ?? 20} selectedKey={p.selectedKey} />
)

describe('Agenda view', () => {
  it('groups by day, all-day first, skips empty days, marks RSVPs', async () => {
    t = renderWith(view([
      ev('Standup', {}),
      ev('Holiday', { start: new Date(2026, 8, 23).toISOString(), end: new Date(2026, 8, 24).toISOString(), allDay: true }),
      ev('Review', { start: at(25, 14), end: at(25, 15, 30), myStatus: 'needsAction' }),
      ev('Party', { start: at(26, 20), end: at(26, 21), myStatus: 'tentative' })
    ]))
    const f = await t.waitFor('Review')
    const lines = f.split('\n')
    expect(lines[0]).toContain('Wed 23 Sep · today')
    expect(lines[1]).toMatch(/● all day +Holiday/)
    expect(lines[2]).toMatch(/● 09:00–10:00 +Standup/)
    expect(lines[3]).toContain('Fri 25 Sep')
    expect(lines[4]).toContain('14:00–15:30 • Review')
    expect(f).toContain('? Party')
    expect(f).not.toContain('Thu 24 Sep')
  })

  it('shows "No events" when the range is empty', async () => {
    t = renderWith(view([]))
    await t.waitFor('No events')
  })

  it('truncates rows to width', async () => {
    t = renderWith(view([ev('x'.repeat(200), {})], { width: 30 }))
    const f = await t.waitFor('xxx')
    for (const l of f.split('\n')) expect(l.length).toBeLessThanOrEqual(30)
  })

  it('scrolls the selected event into view within height', async () => {
    const events = Array.from({ length: 10 }, (_, i) => ev(`E${i}`, { start: at(23 + i, 9), end: at(23 + i, 10) }))
    t = renderWith(view(events, { height: 5 }))
    expect((await t.waitFor('E0')).split('\n')).toHaveLength(5)
    rerender(view(events, { height: 5, selectedKey: eventKey(events[6]) }))
    const f = await t.waitFor('E6')
    expect(f).toContain('Tue 29 Sep') // day header kept above the selection
    expect(f).not.toContain('E0')
    expect(f.split('\n')).toHaveLength(5)
  })

  it('renders seeded events inside the app shell', async () => {
    t = renderApp()
    await t.waitFor('· today')
    expect(t.lastFrame()).toContain('Gym')
  })
})
