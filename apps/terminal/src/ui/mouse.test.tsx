import { afterEach, describe, expect, it } from 'vitest'
import { renderApp, type Rendered } from '../test/harness'

let t: Rendered
afterEach(() => t?.unmount())

describe('mouse', () => {
  it('header tabs and arrows navigate', async () => {
    t = renderApp({ nav: { view: 'agenda', date: new Date(2026, 8, 23) } })
    await t.waitFor('23 Sep – 6 Oct 2026')
    await t.click('2 Days')
    await t.waitFor('23 – 24 Sep 2026')
    await t.click('Month')
    await t.waitFor('September 2026')
    await t.click(' › ')
    await t.waitFor('October 2026')
    await t.click(' ‹ ')
    await t.waitFor('September 2026')
  })

  it('click selects an event, a second click opens it; the preview pane follows', async () => {
    t = renderApp()
    await t.waitFor('Gym')
    await t.waitFor('Up next')
    await t.click('Gym')
    await t.waitFor('Selected')
    expect(t.lastFrame()).not.toContain('esc close')
    await t.click('Gym')
    await t.waitFor('esc close')
    await t.click('esc close')
    await t.waitFor((f) => !f.includes('esc close'))
  })

  it('wheel scrolls without selecting', async () => {
    t = renderApp()
    await t.waitFor('Up next')
    await t.wheel('today ─', 1)
    await new Promise((r) => setTimeout(r, 50))
    expect(t.lastFrame()).toContain('Up next')
    expect(t.lastFrame()).not.toContain('Selected')
  })

  it('a day heading opens the day view', async () => {
    t = renderApp({ nav: { view: 'agenda', date: new Date() } })
    await t.waitFor('today ─')
    await t.click('today ─')
    await t.waitFor('──────┼') // day view's time grid
  })

  it('status line invite count opens invites, and buttons reply', async () => {
    t = renderApp()
    await t.waitFor('invite')
    await t.click('invite')
    await t.waitFor('Invitations')
    await t.waitFor('y accept')
    await t.click('y accept')
    await t.waitFor(() => t.client.events.respond.mock.calls.length > 0)
    expect(t.client.events.respond.mock.calls[0][1]).toBe('accepted')
  })

  it('bottom bar buttons act', async () => {
    t = renderApp()
    await t.waitFor('q quit')
    await t.click('n new')
    await t.waitFor('New event')
  })

  it('mouse reports never reach text fields', async () => {
    t = renderApp()
    await t.waitFor('Gym')
    await t.press('n')
    await t.waitFor('New event')
    await t.click('Location')
    await t.press('x')
    const f = await t.waitFor('› Location')
    expect(f).not.toContain('[<')
    expect(f).toMatch(/Location +x/)
  })
})
