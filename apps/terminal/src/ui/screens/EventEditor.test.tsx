import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY, createTestClient, renderApp, renderWith, type Rendered } from '../../test/harness'
import { EventEditor } from './EventEditor'

let t: Rendered
afterEach(() => t?.unmount())

const clear = (n = 10): string[] => Array(n).fill(KEY.backspace)

describe('EventEditor', () => {
  it('creates via the app: no default account, picks account + calendar, sends create', async () => {
    t = renderApp()
    await t.waitFor('Gym')
    await t.press('n')
    await t.waitFor('New event')
    expect(t.lastFrame()).toContain('choose account')
    await t.press('Standup', KEY.tab) // title → account
    await t.press(KEY.right, KEY.right) // none → work → personal (only writable calendar is preselected)
    await t.waitFor('me@gmail.example')
    expect(t.lastFrame()).toContain('Organizer: me@gmail.example')
    await t.press('\u0013') // ctrl+s
    await t.waitFor('Gym')
    expect(t.client.events.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'personal', calendarId: 'p-main', title: 'Standup', allDay: false })
    )
  })

  it('blocks save without an account', async () => {
    t = renderWith(<EventEditor initialStart={new Date(2026, 8, 23)} onClose={vi.fn()} />)
    await t.waitFor('New event')
    await t.press('\u0013')
    await t.waitFor('Choose an account')
    expect(t.client.events.create).not.toHaveBeenCalled()
  })

  it('validates date format, end before start and emails without sending', async () => {
    const onClose = vi.fn()
    t = renderWith(<EventEditor initialStart={new Date(2026, 8, 23, 9)} onClose={onClose} />)
    await t.waitFor('New event')
    await t.press(KEY.tab, KEY.right, KEY.tab, KEY.tab, KEY.tab) // account work (calendar sole) → start date
    await t.press(...clear(), '2026-13-01', '\u0013')
    await t.waitFor('Invalid start')
    await t.press(...clear(), '2026-09-23', KEY.tab, KEY.tab) // → end date
    await t.press(...clear(), '2026-09-22', '\u0013')
    await t.waitFor('End must be after start')
    await t.press(...clear(), '2026-09-23', KEY.tab, KEY.tab, KEY.tab, KEY.tab) // → invitees
    await t.press('bob@x.com, nope', '\u0013')
    await t.waitFor('Invalid email: nope')
    expect(t.client.events.create).not.toHaveBeenCalled()
    await t.press(...clear(4), KEY.enter) // enter on last field saves
    await t.waitFor(() => onClose.mock.calls.length > 0)
    expect(t.client.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'work', calendarId: 'work-main', attendees: ['bob@x.com'],
        start: new Date(2026, 8, 23, 10).toISOString(), end: new Date(2026, 8, 23, 11).toISOString()
      })
    )
  })

  it('moving the start keeps the duration', async () => {
    t = renderWith(<EventEditor initialStart={new Date(2026, 8, 23, 9)} onClose={vi.fn()} />)
    await t.waitFor('New event')
    await t.press(KEY.down, KEY.down, KEY.down, KEY.down, KEY.down) // → start time
    await t.press(...clear(5), '14:30')
    await t.waitFor('15:30')
  })

  it('edits an existing event with fixed account and sends update', async () => {
    const onClose = vi.fn()
    const client = createTestClient()
    const [event] = (await client.events.list({ start: new Date(0).toISOString(), end: new Date(2100, 0).toISOString() }))
      .filter((e) => e.accountId === 'personal' && e.calendarId === 'p-main' && !e.recurringEventId)
    t = renderWith(<EventEditor event={event} onClose={onClose} />, client)
    await t.waitFor('Edit event')
    expect(t.lastFrame()).toContain('Personal · me@gmail.example')
    await t.press(KEY.right) // arrows don't change the fixed account (focus is on title, text field)
    await t.press(' 2', '\u0013')
    await t.waitFor(() => onClose.mock.calls.length > 0)
    expect(t.client.events.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: event.id, accountId: 'personal', calendarId: 'p-main', title: `${event.title} 2` })
    )
  })

  it('handles a burst of keys with no re-render in between', async () => {
    t = renderWith(<EventEditor initialStart={new Date(2026, 8, 23, 9)} onClose={vi.fn()} />)
    await t.waitFor('New event')
    for (const k of ['A', 'b', 'c', KEY.backspace, KEY.tab, KEY.right, KEY.up, KEY.up, 'x@y.co']) {
      t.stdin.write(k)
    }
    await t.press('\u0013')
    await t.waitFor(() => t.client.events.create.mock.calls.length > 0)
    expect(t.client.events.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'work', title: 'Ab', attendees: ['x@y.co'], start: new Date(2026, 8, 23, 10).toISOString() })
    )
  })

  it('shows server errors and stays open', async () => {
    const onClose = vi.fn()
    t = renderWith(<EventEditor initialStart={new Date(2026, 8, 23, 9)} onClose={onClose} />)
    t.client.events.create.mockRejectedValueOnce(new Error('boom'))
    await t.waitFor('New event')
    await t.press(KEY.tab, KEY.right, '\u0013')
    await t.waitFor('boom')
    expect(onClose).not.toHaveBeenCalled()
    await t.press(KEY.esc)
    expect(onClose).toHaveBeenCalled()
  })
})
