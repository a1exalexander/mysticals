import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { AppError } from '../errors'
import type { Account, Calendar, CalEvent } from '../shared/types'
import { setAllDay, applyForm, emptyForm, errorText, formFromEvent, formToInput, fromLocalInput, moveStart, repeatChanged, toLocalInput, withLoadedRepeat, writableCalendars } from './editor'

const acc = (id: string): Account => ({ id, kind: 'caldav', label: id, email: `me@${id}.example`, color: '#000' })
const cal = (id: string, accountId: string, readOnly = false): Calendar => ({ id, accountId, name: id, color: '#000', readOnly })
const accounts = [acc('work'), acc('personal')]
const calendars = [cal('w', 'work'), cal('p', 'personal'), cal('hol', 'personal', true)]
/** The message a refused input fails with (undefined when it is accepted). */
const refusal = <A>(r: Result.Result<A, AppError>): string | undefined => (Result.isFailure(r) ? r.failure.message : undefined)

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
    expect(refusal(formToInput(f))).toContain('Choose an account')
  })

  it('preselects the only writable account and its only calendar', () => {
    const f = emptyForm(accounts, [cal('w', 'work'), cal('hol', 'personal', true)])
    expect(f.accountId).toBe('work')
    expect(f.calendarId).toBe('w')
  })

  it('builds a timed NewEventInput with no attendees by default', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w', start: '2026-09-24T14:00', end: '2026-09-24T15:00' }
    const input = Result.getOrThrow(formToInput(f))
    expect(input).toMatchObject({ accountId: 'work', calendarId: 'w', title: 'New Event', allDay: false })
    expect(input.start).toBe(fromLocalInput('2026-09-24T14:00'))
    expect(input.attendees).toBeUndefined()
    expect(refusal(formToInput({ ...f, end: f.start }))).toContain('End must be after start')
  })

  it('makes the all-day end exclusive', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w', allDay: true, start: '2026-09-24T09:00', end: '2026-09-25T10:00' }
    expect(Result.getOrThrow(formToInput(f))).toMatchObject({ start: '2026-09-24', end: '2026-09-26', allDay: true })
  })

  it('validates and dedupes attendees', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w' }
    expect(Result.getOrThrow(formToInput({ ...f, attendees: ['A@x.io', 'a@x.io'] })).attendees).toEqual(['a@x.io'])
    expect(refusal(formToInput({ ...f, attendees: ['nope'] }))).toContain('Invalid email: nope')
    expect(refusal(formToInput({ ...f, attendees: ['nope'] }, 'uk'))).toContain('Неправильна адреса: nope')
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
    const out = Result.getOrThrow(applyForm(e, { ...f, accountId: 'personal', calendarId: 'p', title: 'U', attendees: ['bob@x.io', 'eve@x.io'] }))
    expect(out).toMatchObject({ accountId: 'work', calendarId: 'w', title: 'U', start: '2026-09-24', end: '2026-09-25' })
    expect(out.attendees.map((a) => [a.email, a.status])).toEqual([
      ['me@work.example', 'accepted'], ['bob@x.io', 'accepted'], ['eve@x.io', 'needsAction']
    ])
  })

  it('turning all-day off keeps a savable span', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'work', calendarId: 'w', allDay: true, start: '2026-09-24T00:00', end: '2026-09-24T00:00' }
    expect(setAllDay(f, false).end).toBe('2026-09-24T01:00')
    expect(Result.isSuccess(formToInput(setAllDay(f, false)))).toBe(true)
  })

  it('cleans IPC error prefixes', () => {
    expect(errorText(new Error("Error invoking remote method 'events:create': Error: boom"))).toBe('boom')
  })

  it('moving the start keeps the duration, across days', () => {
    const f = { ...emptyForm(accounts, calendars), start: '2026-09-23T16:00', end: '2026-09-23T17:30' }
    expect(moveStart(f, '2026-09-15T09:30')).toMatchObject({ start: '2026-09-15T09:30', end: '2026-09-15T11:00' })
  })

  it('sends a repeat rule on create, and on edit only when it changed', () => {
    const f = { ...emptyForm(accounts, calendars), accountId: 'a1', calendarId: 'c1', repeat: { freq: 'weekly' as const } }
    expect(Result.getOrThrow(formToInput(f)).recurrence).toEqual({ freq: 'weekly' })
    const run: CalEvent = { id: 'r1', accountId: 'a1', calendarId: 'c1', title: 'Run', start: '2026-09-23T07:00:00.000Z', end: '2026-09-23T08:00:00.000Z', allDay: false, attendees: [], recurringEventId: 's' }
    const loading = formFromEvent(run)
    expect(loading.repeatWas).toBeUndefined()
    expect(repeatChanged({ ...loading, repeat: { freq: 'daily' } })).toBe(false) // not loaded: never sent
    const loaded = withLoadedRepeat(loading, { freq: 'daily', count: 7 })
    expect(Result.getOrThrow(applyForm(run, loaded))).not.toHaveProperty('recurrence')
    expect(Result.getOrThrow(applyForm(run, { ...loaded, repeat: null })).recurrence).toBeNull()
    expect(formFromEvent({ ...run, recurringEventId: undefined }).repeatWas).toBeNull()
  })
})
