import { describe, expect, it } from 'vitest'
import { toCalendar } from './index'

describe('toCalendar', () => {
  const base = { url: 'https://dav.example/u/work/', displayName: 'Work', calendarColor: '#FF9500FF' }

  it('maps name, trims Apple 8-digit color, writable by default', () => {
    expect(toCalendar(base, 'acc')).toEqual({ id: base.url, accountId: 'acc', name: 'Work', color: '#FF9500', readOnly: false })
  })

  it('falls back to URL segment and gray color', () => {
    expect(toCalendar({ url: 'https://dav.example/u/my%20cal/' }, 'acc')).toMatchObject({ name: 'my cal', color: '#8e8e93' })
  })

  it('is readOnly when privileges lack write', () => {
    const ro = { ...base, projectedProps: { currentUserPrivilegeSet: { privilege: [{ read: {} }] } } }
    const rw = { ...base, projectedProps: { currentUserPrivilegeSet: { privilege: [{ read: {} }, { writeContent: {} }] } } }
    expect(toCalendar(ro, 'acc').readOnly).toBe(true)
    expect(toCalendar(rw, 'acc').readOnly).toBe(false)
  })
})
