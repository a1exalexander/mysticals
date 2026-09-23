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
  it('day headings, 2-line cards, now-line, free days and badges', async () => {
    t = renderWith(view([
      ev('Standup', { location: 'Room 3 / https://meet.example.com/x', attendees: [{ email: 'a@x', status: 'accepted' }, { email: 'b@x', status: 'accepted' }] }),
      ev('Holiday', { start: new Date(2026, 8, 23).toISOString(), end: new Date(2026, 8, 24).toISOString(), allDay: true }),
      ev('Lunch', { start: at(23, 11, 30), end: at(23, 13) }),
      ev('Sync', { start: at(23, 12, 30), end: at(23, 13, 30) }),
      ev('Late', { start: at(23, 18), end: at(23, 19) }),
      ev('Review', { start: at(25, 14), end: at(25, 15, 30), myStatus: 'needsAction' }),
      ev('Party', { start: at(26, 20), end: at(26, 21), myStatus: 'tentative' })
    ], { height: 40, width: 80 }))
    const f = await t.waitFor('Work  Room 3') // directory loaded
    const lines = f.split('\n')
    expect(lines[0]).toMatch(/^ Wed 23 Sep  today ─+ 5 events · 4h busy/)
    expect(lines[1]).toMatch(/^ all day +▌ Holiday/)
    expect(lines[3]).toMatch(/^  09:00 +▌ Standup +1h$/)
    expect(lines[4]).toMatch(/^  10:00 +▌ Work  Room 3  2 people/)
    expect(lines[5]).toMatch(/▌ Lunch  ● now · ends in 1h +1h 30m$/)
    expect(lines[6]).toContain('⚠ overlaps')
    expect(lines[7]).toMatch(/^  12:00 ─+/) // now-line after the events that have started
    expect(lines[8]).toMatch(/▌ Sync  in 30m/)
    expect(f).toMatch(/▌ Late +1h/)
    expect(f).toMatch(/ Thu 24 Sep  free/)
    expect(f).toMatch(/Fri 25 Sep  in 2 days ─+ 1 event · 1h 30m busy/)
    expect(f).toMatch(/• Review  RSVP/)
    expect(f).toMatch(/\? Party  maybe/)
    expect(f).toMatch(/Sun 27 Sep – Tue 6 Oct  free/)
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

  it('scrolls the selected card (both lines) into view within height', async () => {
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
    await t.waitFor('today ─')
    expect(t.lastFrame()).toContain('Gym')
  })
})
