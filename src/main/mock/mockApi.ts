import type { Api } from '@shared/ipc'
import type { Account, CalEvent } from '@shared/types'
import { MockProvider } from './MockProvider'

const iso = (dayOffset: number, h: number, m = 0): string => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  return d.toISOString()
}

/** Two isolated fake accounts with seeded events. Used when MULTICALS_MOCK=1. */
export function createMockApi(onChanged: (accountId: string) => void): Omit<Api, 'onChanged' | 'onMenu'> {
  const accounts: Account[] = [
    { id: 'work', kind: 'caldav', label: 'Work', email: 'me@work.example', color: '#8be9fd' },
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
  seed(personal, 'p-main', { title: 'Gym', start: iso(0, 19), end: iso(0, 20) })
  seed(personal, 'p-main', { title: 'Dinner with friends', start: iso(2, 20), end: iso(2, 22), location: 'Kyiv' })
  const today = new Date().toISOString().slice(0, 10)
  seed(personal, 'p-holidays', { title: 'Holiday', start: today, end: today, allDay: true })

  const prov = (id: string): MockProvider => {
    const p = providers.get(id)
    if (!p) throw new Error(`unknown account ${id}`)
    return p
  }
  const own = (accountId: string, calendarId: string): MockProvider => {
    const p = prov(accountId)
    if (!p.calendars.some((c) => c.id === calendarId)) throw new Error('calendar does not belong to account')
    return p
  }

  return {
    accounts: {
      list: async () => structuredClone(accounts),
      addGoogle: async () => { throw new Error('Not available in mock mode') },
      addCaldav: async () => { throw new Error('Not available in mock mode') },
      update: async (id, patch) => {
        const a = accounts.find((x) => x.id === id)
        if (!a) throw new Error('unknown account')
        Object.assign(a, patch)
        onChanged(id)
        return structuredClone(a)
      },
      remove: async (id) => {
        const i = accounts.findIndex((a) => a.id === id)
        if (i >= 0) accounts.splice(i, 1)
        providers.delete(id)
        onChanged(id)
      }
    },
    calendars: {
      list: async () =>
        (await Promise.all([...providers.values()].map((p) => p.listCalendars()))).flat()
          .map((c) => ({ ...c, visible: !hidden.has(`${c.accountId}/${c.id}`) })),
      setVisible: async (accountId, calendarId, visible) => {
        const k = `${accountId}/${calendarId}`
        if (visible) hidden.delete(k)
        else hidden.add(k)
        onChanged(accountId)
      }
    },
    events: {
      list: async (range) => {
        const out: CalEvent[] = []
        for (const p of providers.values())
          for (const c of p.calendars)
            if (!hidden.has(`${p.accountId}/${c.id}`)) out.push(...(await p.listEvents(c.id, range)))
        return out
      },
      create: async (input) => {
        const ev = await own(input.accountId, input.calendarId).createEvent(input.calendarId, input)
        onChanged(input.accountId)
        return ev
      },
      update: async (ev) => {
        const r = await own(ev.accountId, ev.calendarId).updateEvent(ev)
        onChanged(ev.accountId)
        return r
      },
      delete: async (ev) => {
        await own(ev.accountId, ev.calendarId).deleteEvent(ev)
        onChanged(ev.accountId)
      },
      respond: async (ev, status) => {
        const r = await own(ev.accountId, ev.calendarId).respond(ev, status)
        onChanged(ev.accountId)
        return r
      }
    },
    sync: { now: async () => {} }
  }
}
