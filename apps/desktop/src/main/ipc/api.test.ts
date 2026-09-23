import { describe, expect, it, vi } from 'vitest'
import type { Account, CalEvent } from '@shared/types'
import type { AccountStore } from '../accounts/store'
import type { SyncEngine } from '../sync/engine'
import { MockProvider } from '../mock/MockProvider'
import { createApi } from './api'

function setup() {
  const accounts: Account[] = [
    { id: 'work', kind: 'caldav', label: 'Work', email: 'me@work.example', color: '#0a84ff' },
    { id: 'personal', kind: 'google', label: 'Personal', email: 'me@gmail.example', color: '#30d158' }
  ]
  const providers: Record<string, MockProvider> = {
    work: new MockProvider('work', 'me@work.example', [{ id: 'work-main', name: 'Work', color: '#0a84ff', readOnly: false }]),
    personal: new MockProvider('personal', 'me@gmail.example', [
      { id: 'p-main', name: 'Personal', color: '#30d158', readOnly: false },
      { id: 'p-holidays', name: 'Holidays', color: '#ff9f0a', readOnly: true }
    ])
  }
  const invite: CalEvent = {
    id: 'inv-1', accountId: 'work', calendarId: 'work-main', title: 'Daily',
    start: '2026-09-23T10:00:00Z', end: '2026-09-23T10:15:00Z', allDay: false,
    attendees: [{ email: 'me@work.example', status: 'needsAction', self: true }], etag: 'e1', raw: 'ICS'
  }
  providers.work.events.push(invite)
  const hidden: Record<string, string[]> = { work: [], personal: [] }
  const store = {
    list: () => accounts,
    get: (id: string) => accounts.find((a) => a.id === id),
    getProvider: (id: string) => providers[id],
    readCache: (id: string) => ({ calendars: providers[id].calendars, events: providers[id].events }),
    hiddenCalendars: (id: string) => hidden[id],
    add: vi.fn(async (meta: Omit<Account, 'id'>) => ({ ...meta, id: 'new' }))
  } as unknown as AccountStore
  const sync = { syncNow: vi.fn(async () => {}) } as unknown as SyncEngine
  const deps = { verifyCaldav: vi.fn(async () => ({ email: 'me@pe.example' })), googleSignIn: vi.fn() }
  for (const p of Object.values(providers)) {
    vi.spyOn(p, 'createEvent')
    vi.spyOn(p, 'respond')
    vi.spyOn(p, 'updateEvent')
  }
  return { api: createApi(store, sync, deps), providers, store, sync, deps, invite, hidden }
}

const newEvent = { title: 'X', start: '2026-09-24T10:00:00Z', end: '2026-09-24T11:00:00Z', allDay: false }

describe('createApi isolation', () => {
  it('create rejects a calendar of another account', async () => {
    const { api, providers } = setup()
    await expect(api.events.create({ ...newEvent, accountId: 'personal', calendarId: 'work-main' })).rejects.toThrow(/belong/)
    expect(providers.work.createEvent).not.toHaveBeenCalled()
    expect(providers.personal.createEvent).not.toHaveBeenCalled()
  })

  it('create rejects a readOnly calendar', async () => {
    const { api } = setup()
    await expect(api.events.create({ ...newEvent, accountId: 'personal', calendarId: 'p-holidays' })).rejects.toThrow(/read-only/)
  })

  it('create rejects an unknown account', async () => {
    const { api } = setup()
    await expect(api.events.create({ ...newEvent, accountId: 'ghost', calendarId: 'work-main' })).rejects.toThrow(/unknown account/)
  })

  it('create calls only the chosen account provider and syncs only it', async () => {
    const { api, providers, sync } = setup()
    const ev = await api.events.create({ ...newEvent, accountId: 'work', calendarId: 'work-main' })
    expect(ev.accountId).toBe('work')
    expect(ev.organizer?.email).toBe('me@work.example')
    expect(providers.work.createEvent).toHaveBeenCalledOnce()
    expect(providers.personal.createEvent).not.toHaveBeenCalled()
    expect(sync.syncNow).toHaveBeenCalledExactlyOnceWith('work')
  })

  it('respond rejects an event whose accountId was tampered with', async () => {
    const { api, providers, invite } = setup()
    await expect(api.events.respond({ ...invite, accountId: 'personal' }, 'accepted')).rejects.toThrow(/belong/)
    await expect(api.events.respond({ ...invite, calendarId: 'other' }, 'accepted')).rejects.toThrow(/belong/)
    expect(providers.work.respond).not.toHaveBeenCalled()
    expect(providers.personal.respond).not.toHaveBeenCalled()
  })

  it('respond goes through the receiving account with the cached event', async () => {
    const { api, providers, invite } = setup()
    await api.events.respond({ ...invite, raw: 'forged', etag: 'forged' }, 'accepted')
    expect(providers.work.respond).toHaveBeenCalledWith(expect.objectContaining({ raw: 'ICS', etag: 'e1' }), 'accepted')
  })

  it('update merges only allowed edits onto the cached event', async () => {
    const { api, providers, invite } = setup()
    await api.events.update({ ...invite, title: 'Renamed', raw: 'forged', organizer: { email: 'evil@x.example' } })
    const sent = vi.mocked(providers.work.updateEvent).mock.calls[0][0]
    expect(sent).toMatchObject({ title: 'Renamed', raw: 'ICS', etag: 'e1' })
    expect(sent.organizer).toBeUndefined()
  })

  it('update/delete reject events of a readOnly calendar', async () => {
    const { api, providers } = setup()
    const holiday = await providers.personal.createEvent('p-holidays', { ...newEvent, accountId: 'personal', calendarId: 'p-holidays' })
    await expect(api.events.update({ ...holiday, title: 'Y' })).rejects.toThrow(/read-only/)
    await expect(api.events.delete(holiday)).rejects.toThrow(/read-only/)
  })

  it('events.list filters by range and skips hidden calendars', async () => {
    const { api, hidden } = setup()
    const range = { start: '2026-09-23T00:00:00Z', end: '2026-09-24T00:00:00Z' }
    expect((await api.events.list(range)).map((e) => e.id)).toEqual(['inv-1'])
    expect(await api.events.list({ start: '2026-09-25T00:00:00Z', end: '2026-09-26T00:00:00Z' })).toEqual([])
    hidden.work = ['work-main']
    expect(await api.events.list(range)).toEqual([])
  })
})

describe('createApi validation', () => {
  it('zod rejects bad input', async () => {
    const { api, deps } = setup()
    await expect(api.events.list({ start: 'yesterday', end: 'today' })).rejects.toThrow()
    await expect(api.events.create({ ...newEvent, accountId: 'work', calendarId: 'work-main', start: 'nope' })).rejects.toThrow()
    await expect(
      api.events.create({ ...newEvent, accountId: 'work', calendarId: 'work-main', attendees: ['not-an-email'] })
    ).rejects.toThrow()
    await expect(api.events.respond(setup().invite, 'maybe' as 'accepted')).rejects.toThrow()
    await expect(api.accounts.update('work', { label: 'x', extra: 1 } as { label: string })).rejects.toThrow()
    const caldav = { label: 'PE', username: 'u', password: 'p' }
    await expect(api.accounts.addCaldav({ ...caldav, serverUrl: 'http://mail.example.com/dav' })).rejects.toThrow(/https/)
    await expect(api.accounts.addCaldav({ ...caldav, serverUrl: 'example.com' })).rejects.toThrow(/https/)
    expect(deps.verifyCaldav).not.toHaveBeenCalled()
  })

  it('addCaldav allows https and loopback http, then adds and syncs', async () => {
    const { api, store, sync, deps } = setup()
    const caldav = { label: 'PE', username: 'u', password: 'p' }
    const a = await api.accounts.addCaldav({ ...caldav, serverUrl: 'https://mail.privateemail.com/caldav' })
    await api.accounts.addCaldav({ ...caldav, serverUrl: 'http://127.0.0.1:5232/' })
    expect(deps.verifyCaldav).toHaveBeenCalledTimes(2)
    expect(a).toMatchObject({ kind: 'caldav', email: 'me@pe.example', label: 'PE' })
    expect(store.add).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'caldav', email: 'me@pe.example' }),
      { kind: 'caldav', serverUrl: 'https://mail.privateemail.com/caldav', username: 'u', password: 'p' }
    )
    expect(sync.syncNow).toHaveBeenCalledWith('new')
  })
})
