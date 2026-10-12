import { addDays, format } from 'date-fns'
import { Effect } from 'effect'
import type { Account, CalEvent, LogEntry } from '../shared/types'
import { withActivityLog, type ActivityStore, type CoreApiEffect } from '../api'
import { AppError, fail } from '../errors'
import { MockProvider } from './MockProvider'

const iso = (dayOffset: number, h: number, m = 0): string => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  return d.toISOString()
}

/** Two isolated fake accounts with seeded events. Used when MYSTICALS_MOCK=1. */
export function createMockApi(onChanged: (accountId: string) => void, onAction?: (e: LogEntry) => void): CoreApiEffect {
  const accounts: Account[] = [
    {
      id: 'work', kind: 'caldav', label: 'Work', email: 'me@work.example', color: '#8be9fd',
      // e2e: a revoked app password; accounts.reauth with any password fixes it.
      ...(process.env.MYSTICALS_MOCK_AUTH_ERROR ? { error: 'CalDAV login failed: the password was changed or revoked', authError: true } : {}),
      // e2e: a sync failure that isn't about credentials.
      ...(process.env.MYSTICALS_MOCK_SYNC_ERROR ? { error: 'Server unreachable' } : {})
    },
    { id: 'personal', kind: 'google', label: 'Personal', email: 'me@gmail.example', color: '#50fa7b' }
  ]
  const providers = new Map<string, MockProvider>([
    ['work', new MockProvider('work', 'me@work.example', [{ id: 'work-main', name: 'Work', color: '#8be9fd', readOnly: false }])],
    [
      'personal',
      new MockProvider('personal', 'me@gmail.example', [
        { id: 'p-main', name: 'Personal', color: '#50fa7b', readOnly: false },
        { id: 'p-holidays', name: 'Holidays', color: '#f1fa8c', readOnly: true }
      ])
    ]
  ])
  const hidden = new Set<string>()
  const work = providers.get('work')!
  const personal = providers.get('personal')!
  const seed = (p: MockProvider, calendarId: string, e: Partial<CalEvent> & Pick<CalEvent, 'title' | 'start' | 'end'>): void => {
    p.events.push({ id: `${p.accountId}-${p.events.length}`, accountId: p.accountId, calendarId, allDay: false, attendees: [], ...e })
  }
  for (let d = -3; d <= 7; d++) {
    seed(work, 'work-main', {
      title: 'Daily standup', start: iso(d, 10), end: iso(d, 10, 15), location: 'https://meet.google.com/abc-defg-hij',
      organizer: { email: 'lead@work.example' }, myStatus: 'accepted',
      attendees: [{ email: 'lead@work.example', status: 'accepted', organizer: true }, { email: 'me@work.example', status: 'accepted', self: true }]
    })
  }
  seed(work, 'work-main', {
    title: 'Sprint planning', start: iso(1, 14), end: iso(1, 15, 30), location: 'Room 3 / https://meet.example.com/sprint-planning',
    organizer: { email: 'pm@work.example' }, myStatus: 'needsAction',
    attendees: [{ email: 'pm@work.example', status: 'accepted', organizer: true }, { email: 'me@work.example', status: 'needsAction', self: true }]
  })
  // Short (30 min) with a long title and a link-only location: the title must win the one-line block.
  seed(work, 'work-main', {
    title: 'Quarterly roadmap sync with design', start: iso(0, 11, 30), end: iso(0, 12), location: 'Zoom https://zoom.us/j/1234567890?pwd=abc'
  })
  seed(personal, 'p-main', { title: 'Gym', start: iso(0, 19), end: iso(0, 20) })
  for (let d = -2; d <= 4; d++) {
    seed(personal, 'p-main', { title: 'Morning run', start: iso(d, 7), end: iso(d, 7, 45), recurringEventId: 'run-series' })
  }
  personal.rules.set('run-series', { freq: 'daily', count: 7 })
  // A Google Meet attached as conference data only (empty location), a self-hosted call and a map link.
  seed(personal, 'p-main', { title: 'Ukraine - Portugal', start: iso(5, 12, 30), end: iso(5, 13), conferenceUrl: 'https://meet.google.com/zon-fdwf-hnk' })
  seed(personal, 'p-main', { title: 'Catch-up', start: iso(5, 16), end: iso(5, 16, 30), location: 'https://meet.namechip.net/catch-up' })
  seed(personal, 'p-main', { title: 'Coffee', start: iso(5, 9), end: iso(5, 9, 30), location: 'Podil https://maps.app.goo.gl/kyiv-coffee' })
  // Teammates blocking a whole working day with timed events, and a meeting inside: long-event layouts.
  for (const title of ['Olena — busy', 'Maksym — busy']) seed(work, 'work-main', { title, start: iso(-2, 9), end: iso(-2, 20) })
  seed(work, 'work-main', { title: 'Design review', start: iso(-2, 14), end: iso(-2, 15) })
  seed(personal, 'p-main', { title: 'Dinner with friends', start: iso(2, 20), end: iso(2, 22), location: 'Kyiv' })
  // Local dates (toISOString() would be off by a day near midnight); all-day ends are exclusive, like Google and iCal.
  const day = (offset: number): string => format(addDays(new Date(), offset), 'yyyy-MM-dd')
  seed(personal, 'p-holidays', { title: 'Holiday', start: day(0), end: day(1), allDay: true })
  // More than three all-day events on one day, so the all-day row collapses.
  for (const title of ['Conference', 'Team offsite', 'Release freeze', 'Birthday'])
    seed(personal, 'p-main', { title, start: day(3), end: day(4), allDay: true })

  const prov = (id: string): Effect.Effect<MockProvider, AppError> => {
    const p = providers.get(id)
    return p ? Effect.succeed(p) : Effect.fail(fail(`unknown account ${id}`))
  }
  const own = (accountId: string, calendarId: string): Effect.Effect<MockProvider, AppError> =>
    Effect.flatMap(prov(accountId), (p) => (p.calendars.some((c) => c.id === calendarId) ? Effect.succeed(p) : Effect.fail(fail('calendar does not belong to account'))))
  const account = (id: string): Effect.Effect<Account, AppError> => {
    const a = accounts.find((x) => x.id === id)
    return a ? Effect.succeed(a) : Effect.fail(fail('unknown account'))
  }
  const changed = (id: string) => Effect.sync(() => onChanged(id))

  const api: CoreApiEffect = {
    accounts: {
      list: () => Effect.sync(() => structuredClone(accounts)),
      addGoogle: () => Effect.fail(fail('Not available in mock mode')),
      addCaldav: () => Effect.fail(fail('Not available in mock mode')),
      update: (id, patch) =>
        account(id).pipe(
          Effect.map((a) => Object.assign(a, patch)),
          Effect.tap(() => changed(id)),
          Effect.map((a) => structuredClone(a))
        ),
      reauth: (id) =>
        account(id).pipe(
          Effect.map((a) => {
            delete a.error
            delete a.authError
            return a
          }),
          Effect.tap(() => changed(id)),
          Effect.map((a) => structuredClone(a))
        ),
      remove: (id) =>
        Effect.sync(() => {
          const i = accounts.findIndex((a) => a.id === id)
          if (i >= 0) accounts.splice(i, 1)
          providers.delete(id)
        }).pipe(Effect.andThen(changed(id)))
    },
    calendars: {
      list: () =>
        Effect.forEach([...providers.values()], (p) => p.listCalendars()).pipe(
          Effect.map((lists) => lists.flat().map((c) => ({ ...c, visible: !hidden.has(`${c.accountId}/${c.id}`) })))
        ),
      setVisible: (accountId, calendarId, visible) =>
        Effect.sync(() => {
          const k = `${accountId}/${calendarId}`
          if (visible) hidden.delete(k)
          else hidden.add(k)
        }).pipe(Effect.andThen(changed(accountId)))
    },
    events: {
      list: (range) =>
        Effect.forEach(
          [...providers.values()].flatMap((p) => p.calendars.map((c) => p.listEvents(c.id, range))),
          (list) => list,
          { concurrency: 'unbounded' }
        ).pipe(Effect.map((lists) => lists.flat())),
      create: (input) =>
        own(input.accountId, input.calendarId).pipe(
          Effect.flatMap((p) => p.createEvent(input.calendarId, input)),
          Effect.tap(() => changed(input.accountId))
        ),
      update: (ev, scope) =>
        own(ev.accountId, ev.calendarId).pipe(
          Effect.flatMap((p) => p.updateEvent(ev, scope)),
          Effect.tap(() => changed(ev.accountId))
        ),
      delete: (ev, scope) =>
        own(ev.accountId, ev.calendarId).pipe(
          Effect.flatMap((p) => p.deleteEvent(ev, scope)),
          Effect.andThen(changed(ev.accountId))
        ),
      recurrence: (ev) => own(ev.accountId, ev.calendarId).pipe(Effect.flatMap((p) => p.getRecurrence(ev))),
      respond: (ev, status) =>
        own(ev.accountId, ev.calendarId).pipe(
          Effect.flatMap((p) => p.respond(ev, status)),
          Effect.tap(() => changed(ev.accountId))
        )
    },
    sync: { now: () => Effect.void }
  }
  const store: ActivityStore = {
    get: (id) => Effect.sync(() => accounts.find((a) => a.id === id)),
    readCache: (id) => Effect.map(prov(id), (p) => ({ calendars: p.calendars, events: p.events }))
  }
  return onAction ? withActivityLog(api, store, onAction) : api
}
