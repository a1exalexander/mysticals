import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY, renderApp, renderWith, type Rendered } from '../../test/harness'
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
      'accepted'
    )
    await t.press(KEY.esc)
    await t.waitFor('Gym')
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
