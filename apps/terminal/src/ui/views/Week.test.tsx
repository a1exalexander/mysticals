import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '@multicals/core/shared/types'
import { renderApp, renderWith, type Rendered } from '../../test/harness'
import { eventKey } from '../hooks'
import { fit, Week } from './Week'

let t: Rendered
afterEach(() => t?.unmount())

const ev = (id: string, title: string, start: string, end: string, allDay = false): CalEvent => ({
  id, accountId: 'work', calendarId: 'c', title, start, end, allDay, attendees: []
})
const props = { now: new Date(2026, 8, 23, 12), onSelect: vi.fn(), onOpen: vi.fn(), width: 140 }

describe('fit', () => {
  it('collapses overflow into "+k more" and scrolls to the selected item', () => {
    expect(fit([1, 2], 3, -1)).toEqual({ shown: [1, 2], more: 0 })
    expect(fit([1, 2, 3, 4, 5], 3, -1)).toEqual({ shown: [1, 2], more: 3 })
    expect(fit([1, 2, 3, 4, 5], 3, 4)).toEqual({ shown: [4, 5], more: 3 })
  })
})

describe('Week view', () => {
  it('renders Monday-first day headers, all-day and timed lines', () => {
    const events = [
      ev('1', 'Offsite', '2026-09-22', '2026-09-23', true),
      ev('2', 'Standup', new Date(2026, 8, 24, 10).toISOString(), new Date(2026, 8, 24, 10, 15).toISOString())
    ]
    t = renderWith(<Week {...props} events={events} date={new Date(2026, 8, 23)} height={10} />)
    const frame = t.lastFrame() ?? ''
    expect(frame.indexOf('Mon 21')).toBeLessThan(frame.indexOf('Sun 27'))
    expect(frame).toContain('Offsite')
    expect(frame).toContain('10:00 Standup')
  })

  it('keeps the selected event visible when a column overflows', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      ev(String(i), `Ev${i}`, new Date(2026, 8, 23, 8 + i).toISOString(), new Date(2026, 8, 23, 9 + i).toISOString())
    )
    t = renderWith(
      <Week {...props} events={events} date={new Date(2026, 8, 23)} height={4} selectedKey={eventKey(events[7])} />
    )
    const frame = t.lastFrame() ?? ''
    expect(frame).toContain('Ev7')
    expect(frame).not.toContain('Ev0')
    expect(frame).toContain('+6 more')
  })

  it('shows mock events from the shell and survives j selection', async () => {
    t = renderApp({ nav: { view: 'week', date: new Date() } })
    await t.waitFor('Holiday')
    await t.press('j', 'j')
    expect(t.lastFrame()).toContain('Holiday')
  })
})
