import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '@multicals/core/shared/types'
import { renderWith, type Rendered } from '../../test/harness'
import type { ClientApi } from '../../client'
import { ApiContext, eventKey } from '../hooks'
import { Day, TwoDay } from './Day'

let t: Rendered
afterEach(() => t?.unmount())
// rerender replaces the root, so re-wrap in the harness's ApiContext
const rerender = (node: React.ReactElement): void =>
  t.rerender(<ApiContext.Provider value={t.client as unknown as ClientApi}>{node}</ApiContext.Provider>)

const at = (h: number, m = 0, d = 23): string => new Date(2026, 8, d, h, m).toISOString()
const allDay = { start: new Date(2026, 8, 23).toISOString(), end: new Date(2026, 8, 24).toISOString(), allDay: true }
const ev = (id: string, p: Partial<CalEvent>): CalEvent => ({
  id, accountId: 'work', calendarId: 'work-main', title: id, start: at(9), end: at(10), allDay: false, attendees: [], ...p
})
const view = (events: CalEvent[], p: { selectedKey?: string; height?: number; now?: Date } = {}) => (
  <Day events={events} date={new Date(2026, 8, 23)} now={p.now ?? new Date(2026, 8, 24, 1)} onSelect={vi.fn()}
    onOpen={vi.fn()} width={60} height={p.height ?? 34} selectedKey={p.selectedKey} />
)
const row = (f: string, gutter: string): string => f.split('\n').find((l) => l.startsWith(gutter))!

describe('Day view', () => {
  it('shows head, all-day row, hour rows and overlapping events side by side', async () => {
    t = renderWith(view([
      ev('Holiday', allDay),
      ev('Alpha', { start: at(9), end: at(11), location: 'Room 3' }),
      ev('Beta', { start: at(9, 30), end: at(10), myStatus: 'needsAction' })
    ]))
    const f = await t.waitFor('Beta')
    const lines = f.split('\n')
    expect(lines[0]).toMatch(/│ Wed 23 ·3/)
    expect(lines[1]).toMatch(/^all +│ ● Holiday/)
    expect(lines[2]).toMatch(/^─+┼─+$/)
    expect(row(f, '09:00')).toMatch(/│ 09:00 Alpha +09:30 • Beta/)
    expect(row(f, '10:00')).toMatch(/│ Room 3 · 2h/) // Alpha's 2nd row, Beta ended
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(60)
  })

  it('collapses extra all-day events into "+N more", keeping a folded selection', async () => {
    const list = [1, 2, 3, 4, 5].map((i) => ev(`AD${i}`, allDay))
    t = renderWith(view(list))
    await t.waitFor('+3 more')
    expect(t.lastFrame()).not.toContain('AD4')
    rerender(view(list, { selectedKey: eventKey(list[3]) }))
    await t.waitFor('AD4')
    expect(t.lastFrame()).toContain('+3 more')
  })

  it('scrolls to now on today and to the selection', async () => {
    const late = ev('Late', { start: at(22), end: at(23) })
    const now = new Date(2026, 8, 23, 14, 5)
    t = renderWith(view([late], { height: 8, now }))
    let f = await t.waitFor('14:05')
    expect(f).not.toContain('00:00')
    expect(f.split('\n')).toHaveLength(8)
    rerender(view([late], { height: 8, now, selectedKey: eventKey(late) }))
    f = await t.waitFor('Late')
    expect(f).toContain('22:00')
  })

  it('2 Days shows the anchor day and the next as two columns', async () => {
    t = renderWith(
      <TwoDay events={[ev('Tomorrow', { start: at(9, 0, 24), end: at(10, 0, 24) })]} date={new Date(2026, 8, 23)}
        now={new Date(2026, 8, 23, 1)} onSelect={vi.fn()} onOpen={vi.fn()} width={80} height={30} />
    )
    const f = await t.waitFor('Tomorrow')
    expect(f.split('\n')[0]).toMatch(/│ Wed 23 +│ Thu 24 ·1/)
    expect(row(f, '09:00').split('│')[2].trim()).toBe('09:00 Tomorrow')
  })
})
