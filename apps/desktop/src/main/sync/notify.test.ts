import { describe, expect, it } from 'vitest'
import type { CalEvent } from '@shared/types'
import { diffEvents, noteText } from './notify'

const now = new Date('2026-09-23T12:00:00Z')
const ev = (id: string, p: Partial<CalEvent> = {}): CalEvent => ({
  id, accountId: 'a', calendarId: 'c', title: id, start: '2026-09-24T10:00:00Z', end: '2026-09-24T11:00:00Z',
  allDay: false, attendees: [], ...p
})

describe('diffEvents', () => {
  it('reports new unanswered invites only', () => {
    const notes = diffEvents([], [ev('inv', { myStatus: 'needsAction' }), ev('mine'), ev('ok', { myStatus: 'accepted' })], now)
    expect(notes.map((n) => [n.kind, n.event.id])).toEqual([['invite', 'inv']])
  })
  it('reports moved/renamed events, not status or etag churn', () => {
    const prev = [ev('t'), ev('n'), ev('s', { myStatus: 'needsAction' }), ev('l')]
    const next = [ev('t', { start: '2026-09-24T12:00:00Z' }), ev('n', { title: 'x', etag: '2' }), ev('s', { myStatus: 'accepted' }), ev('l', { location: 'Room' })]
    expect(diffEvents(prev, next, now).map((n) => n.event.id)).toEqual(['t', 'n', 'l'])
  })
  it('reports cancellations, skips past and declined events', () => {
    const past = { start: '2026-09-22T10:00:00Z', end: '2026-09-22T11:00:00Z' }
    const prev = [ev('gone'), ev('old', past), ev('no', { myStatus: 'declined' })]
    expect(diffEvents(prev, [], now).map((n) => [n.kind, n.event.id])).toEqual([['cancelled', 'gone']])
    expect(diffEvents([ev('old', past)], [ev('old', { ...past, title: 'y' })], now)).toEqual([])
  })
})

describe('noteText', () => {
  it('one banner per note, summary above three', () => {
    const n = { kind: 'invite' as const, event: ev('Standup') }
    expect(noteText([n], 'Work', now)).toHaveLength(1)
    expect(noteText([n], 'Work', now)[0].title).toBe('New invite: Standup')
    expect(noteText([n, n, n, n], 'Work', now)).toEqual([{ title: '4 calendar updates', body: 'Work' }])
  })
})
