import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '@mysticals/core/shared/types'
import { renderApp, renderWith, type Rendered } from '../../test/harness'
import { eventKey } from '../hooks'
import { Month } from './Month'

let t: Rendered
afterEach(() => t?.unmount())

const ev = (i: number, title: string): CalEvent => ({
  id: String(i), accountId: 'work', calendarId: 'c', title, allDay: false, attendees: [],
  start: new Date(2026, 8, 23, 9 + i).toISOString(), end: new Date(2026, 8, 23, 10 + i).toISOString()
})
const events = [ev(0, 'Alpha'), ev(1, 'Beta'), ev(2, 'Gamma')]
const props = { events, now: new Date(2026, 8, 23, 12), onSelect: vi.fn(), onOpen: vi.fn(), width: 140, date: new Date(2026, 8, 1) }

describe('Month view', () => {
  it('renders a Monday-first 6-week grid with titles and "+k" overflow', () => {
    // height 19 → 3 rows per cell: day number + 1 title + "+2"
    t = renderWith(<Month {...props} height={19} />)
    const frame = t.lastFrame() ?? ''
    expect(frame.split('\n')[0]).toMatch(/^Mon\s+Tue/)
    expect(frame).toContain('Alpha')
    expect(frame).toContain('+2')
    expect(frame).not.toContain('Gamma')
  })

  it('keeps the selected event visible in its cell', () => {
    t = renderWith(<Month {...props} height={19} selectedKey={eventKey(events[2])} />)
    expect(t.lastFrame()).toContain('Gamma')
    expect(t.lastFrame()).not.toContain('Alpha')
  })

  it('is reachable from the shell and pages by month', async () => {
    t = renderApp({ nav: { view: 'month', date: new Date(2026, 8, 23) } })
    await t.waitFor('September 2026')
    await t.press('L')
    await t.waitFor('October 2026')
  })
})
