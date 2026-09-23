import { afterEach, describe, expect, it } from 'vitest'
import type { CalEvent, TimeRange } from '@multicals/core/shared/types'
import { createTestClient, KEY, renderApp, type Rendered } from '../test/harness'

let t: Rendered
afterEach(() => t?.unmount())

describe('App shell', () => {
  it('starts on the agenda and switches views by key', async () => {
    t = renderApp({ nav: { view: 'agenda', date: new Date(2026, 8, 23) } })
    await t.waitFor('Agenda ')
    expect(t.lastFrame()).toContain('23 Sep – 6 Oct 2026')
    await t.press('w')
    await t.waitFor('Mon 21')
    await t.press('m')
    await t.waitFor('September 2026')
    await t.press('L')
    await t.waitFor('October 2026')
    await t.press('\u001B[1;2D') // shift+←
    await t.waitFor('September 2026')
    await t.press('2')
    await t.waitFor('23 – 24 Sep 2026')
    expect(t.lastFrame()).toMatch(/│ Wed 23.*│ Thu 24/)
  })

  it('grid arrows: ←/→ move days (nearest time, paging), ↑/↓ stay in the day, month ↓ moves a week', async () => {
    const at = (d: number, h: number): string => new Date(2026, 8, d, h).toISOString()
    const ev = (title: string, d: number, h: number): CalEvent =>
      ({ id: title, title, accountId: 'work', calendarId: 'work-main', start: at(d, h), end: at(d, h + 1), allDay: false, attendees: [] })
    const all = [ev('Alpha', 23, 9), ev('Bravo', 23, 14), ev('Charlie', 24, 13), ev('Delta', 24, 8), ev('Echo', 28, 10), ev('Foxtrot', 30, 10)]
    const client = createTestClient()
    client.events.list.mockImplementation(async (r: TimeRange) => all.filter((e) => e.start < r.end && e.end > r.start))
    t = renderApp({ client, nav: { view: 'week', date: new Date(2026, 8, 23) } })
    await t.waitFor('Alpha')
    const opened = async (): Promise<string> => {
      await t.press(KEY.enter)
      const f = await t.waitFor('esc close')
      await t.press(KEY.esc)
      return f.split('\n').slice(1, 3).join(' ')
    }
    await t.press(KEY.down, KEY.down) // Wed: Alpha, Bravo
    expect(await opened()).toContain('Bravo')
    await t.press(KEY.down) // stays on the day's last event
    expect(await opened()).toContain('Bravo')
    await t.press(KEY.right) // Thu, closest to 14:00
    expect(await opened()).toContain('Charlie')
    await t.press(KEY.right, KEY.right, KEY.right, KEY.right) // Fri..Mon: pages to the next week
    await t.waitFor('28 Sep – 4 Oct 2026')
    await t.waitFor('Echo') // the new page's events are loaded
    expect(await opened()).toContain('Echo')
    await t.press('m', KEY.up, KEY.down, KEY.down) // month ↑/↓ move a week: Mon 28 → 21 → 28 → Oct 5 (next month)
    await t.waitFor('October 2026')
    await t.press(KEY.left, KEY.left, KEY.left, KEY.left, KEY.left) // Oct 5 → Sep 30 (Foxtrot): back to September
    await t.waitFor('Foxtrot')
    expect(await opened()).toContain('Foxtrot')
  })

  it('day view ←/→ change the day; agenda arrows step events', async () => {
    t = renderApp({ nav: { view: 'day', date: new Date(2026, 8, 23) } })
    await t.waitFor('Wed 23 Sep 2026')
    await t.press(KEY.right)
    await t.waitFor('Thu 24 Sep 2026')
    await t.press(KEY.left, KEY.left)
    await t.waitFor('Tue 22 Sep 2026')
    await t.press('a') // keeps the day view's selection (Tue 22 Morning run)
    await t.waitFor('│ Morning run')
    await t.press(KEY.right) // agenda: next event, not next day
    await t.waitFor('│ Daily standup')
  })

  it('j steps events and pages over at the end of the range', async () => {
    t = renderApp({ nav: { view: 'day', date: new Date() } })
    await t.waitFor('Up next')
    await t.press('j')
    await t.waitFor('Selected')
    const today = t.lastFrame()!.split('\n')[0]
    await t.press(...Array(6).fill('j')) // past today's 4 events
    await t.waitFor((f) => f.split('\n')[0] !== today) // header moved to tomorrow
    expect(t.lastFrame()).toContain('Selected')
  })

  it('has a 2-row bottom bar with action buttons', async () => {
    t = renderApp()
    const f = await t.waitFor('invite (i)')
    const lines = f.split('\n')
    expect(lines.at(-1)).toMatch(/n new +r sync +i invites +s accounts +\? help +q quit/)
    expect(lines.at(-2)).toContain('invite (i)')
    expect(lines[0]).not.toContain('multicals')
  })

  it('help overlay pauses the global keymap and closes on any key', async () => {
    t = renderApp()
    await t.waitFor('Agenda ')
    await t.press('?')
    await t.waitFor('this help')
    await t.press('w') // consumed by the overlay, not a view switch
    await t.waitFor('Agenda ')
    expect(t.lastFrame()).not.toContain('this help')
  })

  it('selects with j and opens details with enter', async () => {
    t = renderApp()
    await t.waitFor('Gym') // events loaded
    await t.press('j', KEY.enter)
    await t.waitFor('esc close')
  })

  it('r triggers a sync and reports it', async () => {
    t = renderApp()
    await t.waitFor('Agenda ')
    await t.press('r')
    await t.waitFor('Synced')
    expect(t.client.sync.now).toHaveBeenCalled()
  })

  it('reloads events on a change push', async () => {
    t = renderApp()
    await t.waitFor('Agenda ')
    const before = t.client.events.list.mock.calls.length
    t.client.emitChanged('work')
    await t.waitFor(() => t.client.events.list.mock.calls.length > before)
  })
})
