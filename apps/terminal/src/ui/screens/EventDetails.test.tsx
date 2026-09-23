import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent } from '@multicals/core/shared/types'
import { createTestClient, KEY, renderWith, type Rendered } from '../../test/harness'
import { execFile } from 'node:child_process'
import { EventDetails } from './EventDetails'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

let t: Rendered
afterEach(() => t?.unmount())

async function open(title: string) {
  const client = createTestClient()
  const all = await client.events.list({ start: '2000-01-01T00:00:00Z', end: '2100-01-01T00:00:00Z' })
  const event = all.find((e: CalEvent) => e.title === title)!
  const onClose = vi.fn()
  const onEdit = vi.fn()
  t = renderWith(<EventDetails event={event} onClose={onClose} onEdit={onEdit} />, client)
  await t.waitFor('esc close')
  await t.waitFor((f) => !f.includes('Calendar in')) // directory loaded
  return { event, onClose, onEdit, client }
}

describe('EventDetails', () => {
  it('shows invite details and replies through the owning account', async () => {
    const { event, client } = await open('Sprint planning')
    const frame = t.lastFrame()!
    expect(frame).toContain('Room 3 / https://meet.example.com/sprint-planning')
    expect(frame).toContain('https://meet.example.com/sprint-planning')
    expect(frame).toContain('Work')
    expect(frame).toContain('pm@work.example (organizer)')
    expect(frame).toContain('not answered')
    expect(frame).not.toContain('e edit') // organized by someone else
    await t.press('y')
    expect(client.events.respond).toHaveBeenCalledWith(event, 'accepted')
    expect(client.events.respond.mock.calls[0][0].accountId).toBe('work')
    await t.waitFor('✓ accepted')
    await t.press('o')
    expect(execFile).toHaveBeenCalledWith('open', ['https://meet.example.com/sprint-planning'], expect.any(Function))
  })

  it('shows reply errors and ignores RSVP keys on non-invites', async () => {
    const { client } = await open('Sprint planning')
    client.events.respond.mockRejectedValueOnce(new Error('offline'))
    await t.press('m')
    await t.waitFor('offline')
    t.unmount()
    await open('Dinner with friends')
    await t.press('y', 'n', 'm')
    expect(t.lastFrame()).not.toContain('y accept')
  })

  it('deletes a single event after confirmation and closes', async () => {
    const { event, onClose, onEdit, client } = await open('Dinner with friends')
    await t.press('e')
    expect(onEdit).toHaveBeenCalledWith(event)
    await t.press('x')
    await t.waitFor('Delete this event?')
    await t.press('n')
    expect(t.lastFrame()).not.toContain('Delete this event?')
    await t.press('x', 'y')
    expect(client.events.delete).toHaveBeenCalledWith(event, 'one')
    expect(onClose).toHaveBeenCalled()
  })

  it('asks the scope for recurring events', async () => {
    const { event, onClose, client } = await open('Morning run')
    await t.press('x')
    await t.waitFor('this and following')
    await t.press('2')
    expect(client.events.delete).toHaveBeenCalledWith(event, 'following')
    expect(onClose).toHaveBeenCalled()
  })

  it('hides edit/delete on read-only calendars and closes on esc', async () => {
    const { onClose, onEdit, client } = await open('Holiday')
    expect(t.lastFrame()).not.toContain('x delete')
    await t.press('e', 'x')
    expect(onEdit).not.toHaveBeenCalled()
    expect(t.lastFrame()).not.toContain('Delete')
    expect(client.events.delete).not.toHaveBeenCalled()
    await t.press(KEY.esc)
    expect(onClose).toHaveBeenCalled()
  })
})
