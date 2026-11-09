import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY, renderApp, renderWith, type Rendered } from '../../test/harness'
import type { CalEvent } from '@mysticals/core/shared/types'
import { Invites } from './Invites'

let t: Rendered
afterEach(() => t?.unmount())

describe('Invites', () => {
  it('opens with i and accepts through the invite’s own account', async () => {
    t = renderApp()
    await t.waitFor('Gym')
    await t.press('i')
    await t.waitFor('Sprint planning')
    expect(t.lastFrame()).toContain('Work · me@work.example')
    await t.press('y', 'y') // the repeat is ignored: one reply per invite
    await t.waitFor('No pending invites') // change push reloads the list
    expect(t.client.events.respond).toHaveBeenCalledTimes(1)
    expect(t.client.events.respond).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sprint planning', accountId: 'work', calendarId: 'work-main' }),
      'accepted',
      'one'
    )
    await t.press(KEY.esc)
    await t.waitFor('Gym')
  })

  it('asks whether a reply to a series is for this event or all of them', async () => {
    t = renderWith(<Invites onClose={vi.fn()} />)
    await t.waitFor('Sprint planning')
    const invite = ((await t.client.events.list.mock.results[0].value) as CalEvent[]).find((e) => e.title === 'Sprint planning')!
    t.client.events.list.mockResolvedValue([{ ...invite, recurringEventId: 'sprint-series' }])
    t.client.emitChanged('work')
    await t.press('n')
    await t.waitFor('Reply to recurring event')
    expect(t.client.events.respond).not.toHaveBeenCalled()
    await t.press('3')
    expect(t.client.events.respond).toHaveBeenCalledWith(expect.objectContaining({ recurringEventId: 'sprint-series' }), 'declined', 'all')
  })

  it('shows respond errors and closes on q', async () => {
    const onClose = vi.fn()
    t = renderWith(<Invites onClose={onClose} />)
    await t.waitFor('Sprint planning')
    t.client.events.respond.mockRejectedValueOnce(new Error('boom'))
    await t.press('n')
    await t.waitFor('boom')
    await t.press('q')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an empty state', async () => {
    t = renderWith(<Invites onClose={vi.fn()} />)
    t.client.events.list.mockResolvedValue([])
    t.client.emitChanged('work')
    await t.waitFor('No pending invites')
  })
})
