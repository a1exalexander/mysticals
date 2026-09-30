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
    await t.press(...clear(), '2026-09-23', KEY.tab, KEY.tab, KEY.tab, KEY.tab, KEY.tab) // → end time, repeat, location, notes, invitees
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
      expect.objectContaining({ id: event.id, accountId: 'personal', calendarId: 'p-main', title: `${event.title} 2` }),
      undefined
    )
  })

  it('asks the scope when saving a recurring event', async () => {
    const onClose = vi.fn()
    const client = createTestClient()
    const [run] = (await client.events.list({ start: new Date(0).toISOString(), end: new Date(2100, 0).toISOString() })).filter((e) => e.recurringEventId)
    t = renderWith(<EventEditor event={run} onClose={onClose} />, client)
    await t.waitFor('Edit event')
    await t.press('!', '\u0013')
    await t.waitFor('Save recurring event')
    expect(t.client.events.update).not.toHaveBeenCalled()
    await t.press(KEY.esc) // back to the form, still open
    await t.waitFor(() => !t.lastFrame()!.includes('Save recurring event'))
    expect(onClose).not.toHaveBeenCalled()
    await t.press('\u0013')
    await t.waitFor('Save recurring event')
    await t.press('3')
    await t.waitFor(() => onClose.mock.calls.length > 0)
    expect(t.client.events.update).toHaveBeenCalledWith(expect.objectContaining({ id: run.id, title: `${run.title}!` }), 'all')
  })

  it('creates a repeating event from a preset, with an end', async () => {
    const onClose = vi.fn()
    t = renderWith(<EventEditor initialStart={new Date(2026, 8, 23, 9)} onClose={onClose} />)
    await t.waitFor('New event')
    await t.press(KEY.tab, KEY.right) // account work (calendar sole)
    await t.press(...Array(7).fill(KEY.tab)) // → repeat
    await t.press(KEY.right, KEY.right) // does not repeat → every day → every week
    await t.waitFor('Every week on Wednesday')
    await t.press(KEY.tab, ...clear(5), '4 times', '\u0013')
    await t.waitFor(() => onClose.mock.calls.length > 0)
    expect(t.client.events.create).toHaveBeenCalledWith(expect.objectContaining({ recurrence: { freq: 'weekly', count: 4 } }))
  })

  it('creates a custom rule: every 2 days, 3 times; bad text is reported', async () => {
    const onClose = vi.fn()
    t = renderWith(<EventEditor initialStart={new Date(2026, 8, 23, 9)} onClose={onClose} />)
    await t.waitFor('New event')
    await t.press(KEY.tab, KEY.right, ...Array(7).fill(KEY.tab), KEY.left) // repeat: none ← custom
    await t.waitFor('Custom')
    await t.press(KEY.tab, ...clear(), 'often', '\u0013')
    await t.waitFor('Repeat every')
    await t.press(...clear(), '2 days', KEY.tab, KEY.tab, ...clear(), '3', '\u0013')
    await t.waitFor(() => onClose.mock.calls.length > 0)
    expect(t.client.events.create).toHaveBeenCalledWith(expect.objectContaining({ recurrence: { freq: 'daily', interval: 2, count: 3 } }))
  })

  it('changing the rule of a series offers only this-and-following or all events', async () => {
    const onClose = vi.fn()
    const client = createTestClient()
    const [run] = (await client.events.list({ start: new Date(0).toISOString(), end: new Date(2100, 0).toISOString() })).filter((e) => e.recurringEventId)
    t = renderWith(<EventEditor event={run} onClose={onClose} />, client)
    await t.waitFor('Every day') // the loaded rule: daily, 7 times
    expect(t.lastFrame()).toContain('7 times')
    await t.press(...Array(6).fill(KEY.tab), KEY.right, '\u0013') // repeat → every week, save
    await t.waitFor('Change the repeat rule for')
    expect(t.lastFrame()).not.toContain('this event')
    await t.press('1')
    expect(t.client.events.update).not.toHaveBeenCalled()
    await t.press('3')
    await t.waitFor(() => onClose.mock.calls.length > 0)
    expect(t.client.events.update).toHaveBeenCalledWith(expect.objectContaining({ recurrence: { freq: 'weekly', count: 7 } }), 'all')
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
