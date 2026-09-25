import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '@mysticals/core/shared/types'
import { renderApp, renderWith, type Rendered } from '../../test/harness'
import { eventKey } from '../hooks'
import { Week } from './Week'
import { abutting } from './TimeGrid'

let t: Rendered
afterEach(() => t?.unmount())

const at = (d: number, h: number, m = 0): string => new Date(2026, 8, d, h, m).toISOString()
const ev = (id: string, title: string, start: string, end: string, allDay = false): CalEvent => ({
  id, accountId: 'work', calendarId: 'c', title, start, end, allDay, attendees: []
})
const props = { now: new Date(2026, 8, 23, 12, 34), onSelect: vi.fn(), onOpen: vi.fn(), width: 120, date: new Date(2026, 8, 23) }
/** Cell text of day column `col` (0 = Monday) on the row starting with `gutter`. */
const cell = (frame: string, gutter: string, col: number): string =>
  frame.split('\n').find((l) => l.startsWith(gutter))!.split('│')[col + 1].trim()

describe('Week view', () => {
  it('is a Monday-first time-grid table: head, all-day row, rule, hour rows', () => {
    const events = [
      ev('1', 'Offsite', '2026-09-22', '2026-09-23', true),
      ev('2', 'Standup', at(24, 10), at(24, 10, 15)),
      ev('3', 'Review', at(25, 14, 30), at(25, 16))
    ]
    t = renderWith(<Week {...props} events={events} height={30} />)
    const f = t.lastFrame()!
    const lines = f.split('\n')
    expect(lines[0]).toMatch(/^ +│ Mon 21 +│ Tue 22 ·1 +│ Wed 23 +│ Thu 24 ·1/)
    expect(cell(f, 'all', 1)).toBe('● Offsite')
    expect(lines[2]).toMatch(/^─+┼─+┼/)
    expect(cell(f, '10:00', 3)).toBe('Standup')
    expect(cell(f, '14:00', 4)).toBe('Review') // 90 min → 3 rows: title, times, (place)
    expect(cell(f, '15:00', 4)).toBe('14:30–16:00')
    expect(cell(f, '10:00', 4)).toBe('')
  })

  it('marks the current time: red clock in the gutter and a now-line across every day', () => {
    const lunch = ev('4', 'Lunch', at(24, 12), at(24, 13))
    t = renderWith(<Week {...props} events={[lunch]} height={30} />)
    const f = t.lastFrame()!
    const line = f.split('\n').find((l) => l.startsWith('12:34'))!
    const cells = line.split('┼')
    expect(cells[0]).toBe('12:34─')
    expect(cells).toHaveLength(8) // the line crosses all seven day columns
    expect(cells[3]).toMatch(/^─+$/) // Wed 23 = today
    expect(cells[1]).toMatch(/^─+$/)
    expect(cells[4]).toContain('Lunch') // blocks stay on top of the line
    expect(f).not.toContain('12:00')
  })

  it('underlines the last row of a block that another block follows directly', () => {
    const slot = (start: number, end: number, col = 0, cols = 1) => ({ item: {} as never, start, end, col, cols })
    const a = slot(540, 600) // 09–10
    const b = slot(600, 720) // 10–12, right after a
    const c = slot(720, 780, 1, 2) // 12–13, right half: touches b's span
    const d = slot(900, 960) // 15–16, after a gap
    expect([...abutting([a, b, c, d])]).toEqual([a, b])
    expect([...abutting([slot(540, 600, 0, 2), slot(600, 660, 1, 2)])]).toEqual([]) // side by side, not stacked
  })

  it('scrolls the selected event into view', () => {
    const late = ev('9', 'Late', at(26, 22), at(26, 23))
    t = renderWith(<Week {...props} events={[late]} height={8} selectedKey={eventKey(late)} />)
    expect(cell(t.lastFrame()!, '22:00', 5)).toBe('Late')
  })

  it('shows mock events from the shell and survives selection', async () => {
    t = renderApp({ nav: { view: 'week', date: new Date() } })
    await t.waitFor('Holiday')
    await t.press('j', 'j')
    expect(t.lastFrame()).toContain('Holiday')
  })
})
