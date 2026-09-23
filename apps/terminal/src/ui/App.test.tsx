import { afterEach, describe, expect, it } from 'vitest'
import { KEY, renderApp, type Rendered } from '../test/harness'

let t: Rendered
afterEach(() => t?.unmount())

describe('App shell', () => {
  it('starts on the agenda and switches views by key', async () => {
    t = renderApp({ nav: { view: 'agenda', date: new Date(2026, 8, 23) } })
    await t.waitFor('Agenda view')
    expect(t.lastFrame()).toContain('23 Sep – 6 Oct 2026')
    await t.press('w')
    await t.waitFor('Week view')
    await t.press('m')
    await t.waitFor('September 2026')
    await t.press('l')
    await t.waitFor('October 2026')
    await t.press('d', 't')
    expect(t.lastFrame()).toContain('Day view')
  })

  it('help overlay pauses the global keymap and closes on any key', async () => {
    t = renderApp()
    await t.waitFor('Agenda view')
    await t.press('?')
    await t.waitFor('this help')
    await t.press('w') // consumed by the overlay, not a view switch
    await t.waitFor('Agenda view')
    expect(t.lastFrame()).not.toContain('this help')
  })

  it('selects with j and opens details with enter', async () => {
    t = renderApp()
    await t.waitFor('Agenda view')
    await t.press('j', KEY.enter)
    await t.waitFor('esc close')
  })

  it('r triggers a sync and reports it', async () => {
    t = renderApp()
    await t.waitFor('Agenda view')
    await t.press('r')
    await t.waitFor('Synced')
    expect(t.client.sync.now).toHaveBeenCalled()
  })

  it('reloads events on a change push', async () => {
    t = renderApp()
    await t.waitFor('Agenda view')
    const before = t.client.events.list.mock.calls.length
    t.client.emitChanged('work')
    await t.waitFor(() => t.client.events.list.mock.calls.length > before)
  })
})
