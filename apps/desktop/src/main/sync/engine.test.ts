import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, CalEvent } from '@shared/types'
import type { AccountCache } from '../accounts/store'
import { MockProvider } from '../mock/MockProvider'
import { queryEvents, SyncEngine } from './engine'

class FakeStore {
  accounts: Account[] = []
  providers = new Map<string, MockProvider>()
  caches = new Map<string, AccountCache>()
  hidden = new Map<string, string[]>()

  add(id: string): MockProvider {
    this.accounts.push({ id, kind: 'caldav', label: id, email: `${id}@x.test`, color: '#000' })
    const p = new MockProvider(id, `${id}@x.test`, [{ id: `${id}-cal`, name: 'Cal', color: '#111', readOnly: false }])
    this.providers.set(id, p)
    return p
  }
  list(): Account[] {
    return this.accounts
  }
  getProvider(id: string): MockProvider {
    return this.providers.get(id)!
  }
  readCache(id: string): AccountCache {
    return this.caches.get(id) ?? { calendars: [], events: [] }
  }
  async writeCache(id: string, cache: AccountCache): Promise<void> {
    this.caches.set(id, structuredClone(cache))
  }
  async update(id: string, patch: { error?: string }): Promise<Account> {
    const a = this.accounts.find((x) => x.id === id)!
    Object.assign(a, patch)
    return a
  }
  hiddenCalendars(id: string): string[] {
    return this.hidden.get(id) ?? []
  }
}

function ev(id: string, calendarId: string, start: string, end: string, accountId = 'x'): CalEvent {
  return { id, accountId, calendarId, title: id, start, end, allDay: false, attendees: [] }
}

const tick = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(0))
const noTriggers = (): (() => void) => () => {}

describe('SyncEngine', () => {
  let store: FakeStore
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'))
    store = new FakeStore()
  })
  afterEach(() => vi.useRealTimers())

  it('one failing account does not affect the other', async () => {
    const work = store.add('work')
    store.add('personal')
    work.events.push(ev('w1', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'work'))
    vi.spyOn(store.getProvider('personal'), 'listCalendars').mockRejectedValue(new Error('401'))
    const changed = vi.fn()
    await new SyncEngine(store, changed, { triggers: noTriggers }).syncNow()
    expect(store.caches.get('work')!.events.map((e) => e.id)).toEqual(['w1'])
    expect(store.accounts[1].error).toBe('401')
    expect(store.accounts[0].error).toBeUndefined()
    expect(changed).toHaveBeenCalledWith('work')
  })

  it('stamps accountId and calendarId, ignoring provider values', async () => {
    const work = store.add('work')
    work.events.push(ev('w1', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'personal'))
    vi.spyOn(work, 'listEvents').mockImplementation(async () => [
      ev('w1', 'other-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'personal')
    ])
    vi.spyOn(work, 'listCalendars').mockResolvedValue([
      { id: 'work-cal', accountId: 'personal', name: 'C', color: '#1', readOnly: false }
    ])
    await new SyncEngine(store, () => {}, { triggers: noTriggers }).syncNow('work')
    const cache = store.caches.get('work')!
    expect(cache.calendars[0].accountId).toBe('work')
    expect(cache.events[0]).toMatchObject({ accountId: 'work', calendarId: 'work-cal' })
  })

  it('calls onChanged only when content differs', async () => {
    const work = store.add('work')
    const changed = vi.fn()
    const engine = new SyncEngine(store, changed, { triggers: noTriggers })
    await engine.syncNow('work') // first sync: calendars appear
    expect(changed).toHaveBeenCalledTimes(1)
    await engine.syncNow('work')
    expect(changed).toHaveBeenCalledTimes(1)
    work.events.push(ev('w1', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z'))
    await engine.syncNow('work')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('reports event notes only after the first sync and never for quiet syncs', async () => {
    const work = store.add('work')
    const onEvents = vi.fn()
    const engine = new SyncEngine(store, () => {}, { triggers: noTriggers, onEvents })
    const invite = (id: string): CalEvent => ({ ...ev(id, 'work-cal', '2026-09-24T09:00:00Z', '2026-09-24T10:00:00Z'), myStatus: 'needsAction' })
    work.events.push(invite('i0'))
    await engine.syncNow('work') // first sync: everything is "new", stay silent
    expect(onEvents).not.toHaveBeenCalled()
    work.events.push(invite('i1'))
    await engine.syncNow('work', { quiet: true })
    expect(onEvents).not.toHaveBeenCalled()
    work.events.push(invite('i2'))
    await engine.syncNow('work')
    expect(onEvents).toHaveBeenCalledExactlyOnceWith('work', [expect.objectContaining({ kind: 'invite', event: expect.objectContaining({ id: 'i2' }) })])
  })

  it('does not run concurrent syncs for the same account', async () => {
    const work = store.add('work')
    const spy = vi.spyOn(work, 'listCalendars')
    const engine = new SyncEngine(store, () => {}, { triggers: noTriggers })
    await Promise.all([engine.syncNow('work'), engine.syncNow('work'), engine.syncNow()])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('backs off exponentially per account, keeps cache, clears error on recovery', async () => {
    const work = store.add('work')
    store.add('personal')
    const okSpy = vi.spyOn(store.getProvider('personal'), 'listCalendars')
    const fail = vi.spyOn(work, 'listCalendars').mockRejectedValue(new Error('down'))
    store.caches.set('work', { calendars: [], events: [ev('old', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z')] })
    const engine = new SyncEngine(store, () => {}, { intervalMs: 60_000, maxBackoffMs: 5 * 60_000, triggers: noTriggers })
    engine.start()
    await tick()
    expect(fail).toHaveBeenCalledTimes(1)
    expect(store.caches.get('work')!.events[0].id).toBe('old')

    await vi.advanceTimersByTimeAsync(60_000) // personal: 1 min
    expect(okSpy).toHaveBeenCalledTimes(2)
    expect(fail).toHaveBeenCalledTimes(1) // work waits 2 min
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fail).toHaveBeenCalledTimes(2) // next wait 4 min
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(fail).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fail).toHaveBeenCalledTimes(3) // next wait capped at 5 min
    expect(store.accounts[0].error).toBe('down')

    fail.mockRestore()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(store.accounts[0].error).toBeUndefined()
    engine.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('syncs on trigger and stops listening after stop()', async () => {
    const work = store.add('work')
    const spy = vi.spyOn(work, 'listCalendars')
    let fire = (): void => {}
    const unsub = vi.fn()
    const engine = new SyncEngine(store, () => {}, {
      triggers: (f) => {
        fire = f
        return unsub
      }
    })
    engine.start()
    await tick()
    fire()
    await tick()
    expect(spy).toHaveBeenCalledTimes(2)
    engine.stop()
    expect(unsub).toHaveBeenCalled()
  })
})

describe('queryEvents', () => {
  it('filters by range overlap, hidden calendars and foreign accountIds', () => {
    const store = new FakeStore()
    store.add('work')
    store.add('personal')
    store.caches.set('work', {
      calendars: [],
      events: [
        ev('in', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'work'),
        ev('overlap', 'work-cal', '2026-09-22T23:00:00Z', '2026-09-23T01:00:00Z', 'work'),
        ev('before', 'work-cal', '2026-09-22T09:00:00Z', '2026-09-23T00:00:00Z', 'work'),
        ev('after', 'work-cal', '2026-09-24T00:00:00Z', '2026-09-24T01:00:00Z', 'work'),
        ev('foreign', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'personal')
      ]
    })
    store.caches.set('personal', {
      calendars: [],
      events: [ev('hidden', 'personal-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'personal')]
    })
    store.hidden.set('personal', ['personal-cal'])
    const range = { start: '2026-09-23T00:00:00Z', end: '2026-09-24T00:00:00Z' }
    expect(queryEvents(store, range).map((e) => e.id).sort()).toEqual(['in', 'overlap'])
    expect(queryEvents(store, range, false).map((e) => e.id).sort()).toEqual(['hidden', 'in', 'overlap'])
  })
})
