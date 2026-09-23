import { describe, expect, it } from 'vitest'
import type { Calendar, CalEvent } from '../shared/types'
import { visibleEvents } from './visible'

describe('visibleEvents', () => {
  it('drops only events of calendars marked visible: false, per account', () => {
    const cal = (accountId: string, id: string, visible?: boolean): Calendar =>
      ({ accountId, id, name: id, color: '#000000', readOnly: false, visible }) as Calendar
    const ev = (accountId: string, calendarId: string): CalEvent =>
      ({ id: `${accountId}-${calendarId}`, accountId, calendarId }) as CalEvent
    const events = [ev('a', 'main'), ev('b', 'main'), ev('a', 'other'), ev('c', 'unknown')]
    const out = visibleEvents(events, [cal('a', 'main', false), cal('b', 'main', true), cal('a', 'other')])
    expect(out.map((e) => e.id)).toEqual(['b-main', 'a-other', 'c-unknown'])
  })
})
