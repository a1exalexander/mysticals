import { describe, expect, it } from 'vitest'
import type { Account, Calendar, CalEvent } from '@shared/types'
import { setAllDay, applyForm, emptyForm, errorText, formFromEvent, formToInput, fromLocalInput, moveStart, toLocalInput, writableCalendars } from './EventEditor.logic'

const acc = (id: string): Account => ({ id, kind: 'caldav', label: id, email: `me@${id}.example`, color: '#000' })
const cal = (id: string, accountId: string, readOnly = false): Calendar => ({ id, accountId, name: id, color: '#000', readOnly })
const accounts = [acc('work'), acc('personal')]
const calendars = [cal('w', 'work'), cal('p', 'personal'), cal('hol', 'personal', true)]

describe('event form', () => {
  it('round-trips datetime-local and ISO', () => {
    const local = '2026-09-24T14:30'
    expect(toLocalInput(fromLocalInput(local))).toBe(local)
    expect(toLocalInput('2026-09-24')).toBe('2026-09-24T00:00')
  })

  it('lists only the account own writable calendars', () => {
    expect(writableCalendars(calendars, 'personal').map((c) => c.id)).toEqual(['p'])
    expect(writableCalendars(calendars, 'work').map((c) => c.id)).toEqual(['w'])
  })

  it('never preselects an account when several are writable', () => {
    const f = emptyForm(accounts, calendars)
    expect(f.accountId).toBe('')
    expect(f.calendarId).toBe('')
    expect(() => formToInput(f)).toThrow('Choose an account')
  })

  it('preselects the only writable account and its only calendar', () => {
    const f = emptyForm(accounts, [cal('w', 'work'), cal('hol', 'personal', true)])
    expect(f.accountId).toBe('work')
    expect(f.calendarId).toBe('w')
  })

  it('builds a timed NewEventInput with no attendees by default', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w', start: '2026-09-24T14:00', end: '2026-09-24T15:00' }
    const input = formToInput(f)
    expect(input).toMatchObject({ accountId: 'work', calendarId: 'w', title: 'New Event', allDay: false })
    expect(input.start).toBe(fromLocalInput('2026-09-24T14:00'))
    expect(input.attendees).toBeUndefined()
    expect(() => formToInput({ ...f, end: f.start })).toThrow('End must be after start')
  })

  it('makes the all-day end exclusive', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w', allDay: true, start: '2026-09-24T09:00', end: '2026-09-25T10:00' }
    expect(formToInput(f)).toMatchObject({ start: '2026-09-24', end: '2026-09-26', allDay: true })
  })

  it('validates and dedupes attendees', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w' }
    expect(formToInput({ ...f, attendees: ['A@x.io', 'a@x.io'] }).attendees).toEqual(['a@x.io'])
    expect(() => formToInput({ ...f, attendees: ['nope'] })).toThrow('Invalid email: nope')
  })

  it('edits keep account, calendar, organizer and known statuses', () => {
    const e: CalEvent = {
      id: '1', accountId: 'work', calendarId: 'w', title: 'T', start: '2026-09-24', end: '2026-09-25', allDay: true,
      organizer: { email: 'me@work.example' },
      attendees: [{ email: 'me@work.example', status: 'accepted', self: true, organizer: true }, { email: 'bob@x.io', status: 'accepted' }]
    }
    const f = formFromEvent(e)
    expect(f.end.slice(0, 10)).toBe('2026-09-24')
    expect(f.attendees).toEqual(['bob@x.io'])
    const out = applyForm(e, { ...f, accountId: 'personal', calendarId: 'p', title: 'U', attendees: ['bob@x.io', 'eve@x.io'] })
    expect(out).toMatchObject({ accountId: 'work', calendarId: 'w', title: 'U', start: '2026-09-24', end: '2026-09-25' })
    expect(out.attendees.map((a) => [a.email, a.status])).toEqual([
      ['me@work.example', 'accepted'], ['bob@x.io', 'accepted'], ['eve@x.io', 'needsAction']
    ])
  })

  it('turning all-day off keeps a savable span', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w', allDay: true, start: '2026-09-24T00:00', end: '2026-09-24T00:00' }
    expect(setAllDay(f, false).end).toBe('2026-09-24T01:00')
    expect(() => formToInput(setAllDay(f, false))).not.toThrow()
  })

  it('cleans IPC error prefixes', () => {
    expect(errorText(new Error("Error invoking remote method 'events:create': Error: boom"))).toBe('boom')
  })

  it('moving the start keeps the duration, across days', () => {
    const f = { ...emptyForm(accounts, calendars), start: '2026-09-23T16:00', end: '2026-09-23T17:30' }
    expect(moveStart(f, '2026-09-15T09:30')).toMatchObject({ start: '2026-09-15T09:30', end: '2026-09-15T11:00' })
  })
})
