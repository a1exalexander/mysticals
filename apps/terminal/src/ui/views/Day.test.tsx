import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '@multicals/core/shared/types'
import { renderWith, type Rendered } from '../../test/harness'
import type { ClientApi } from '../../client'
import { ApiContext, eventKey } from '../hooks'
import { Day } from './Day'

let t: Rendered
afterEach(() => t?.unmount())
// rerender replaces the root, so re-wrap in the harness's ApiContext
const rerender = (node: React.ReactElement): void =>
  t.rerender(<ApiContext.Provider value={t.client as unknown as ClientApi}>{node}</ApiContext.Provider>)

const at = (h: number, m = 0): string => new Date(2026, 8, 23, h, m).toISOString()
const allDay = { start: new Date(2026, 8, 23).toISOString(), end: new Date(2026, 8, 24).toISOString(), allDay: true }
const ev = (id: string, p: Partial<CalEvent>): CalEvent => ({
  id, accountId: 'work', calendarId: 'work-main', title: id, start: at(9), end: at(10), allDay: false, attendees: [], ...p
})
const view = (events: CalEvent[], p: { selectedKey?: string; height?: number; now?: Date } = {}) => (
  <Day events={events} date={new Date(2026, 8, 23)} now={p.now ?? new Date(2026, 8, 23, 1)} onSelect={vi.fn()}
    onOpen={vi.fn()} width={60} height={p.height ?? 30} selectedKey={p.selectedKey} />
)

describe('Day view', () => {
  it('shows all-day strip, hour rows and overlapping events side by side', async () => {
    t = renderWith(view([
      ev('Holiday', allDay),
      ev('Alpha', { start: at(9), end: at(11) }),
      ev('Beta', { start: at(9, 30), end: at(10), myStatus: 'needsAction' })
    ]))
    const f = await t.waitFor('Beta')
    const lines = f.split('\n')
    expect(lines[0]).toMatch(/^all +● Holiday/)
    expect(lines[1]).toMatch(/^00:00/)
    expect(lines.find((l) => l.startsWith('09:00'))).toMatch(/● 09:00 Alpha +● 09:30 • Beta/)
    expect(lines.find((l) => l.startsWith('10:00'))).toMatch(/^10:00 +│$/) // Alpha continues, Beta ended
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(60)
  })

  it('collapses extra all-day events into "+N more"', async () => {
    const list = [1, 2, 3, 4, 5].map((i) => ev(`AD${i}`, allDay))
    t = renderWith(view(list))
    await t.waitFor('+3 more all-day')
    expect(t.lastFrame()).not.toContain('AD4')
    rerender(view(list, { selectedKey: eventKey(list[3]) })) // a folded selection stays visible
    await t.waitFor('AD4')
    expect(t.lastFrame()).toContain('+3 more all-day')
  })

  it('scrolls to now on today and to the selection', async () => {
    const late = ev('Late', { start: at(22), end: at(23) })
    const now = new Date(2026, 8, 23, 14)
    t = renderWith(view([late], { height: 6, now }))
    let f = await t.waitFor('14:00')
    expect(f).not.toContain('00:00')
    expect(f.split('\n')).toHaveLength(6)
    rerender(view([late], { height: 6, now, selectedKey: eventKey(late) }))
    f = await t.waitFor('Late')
    expect(f).toContain('22:00')
  })
})
