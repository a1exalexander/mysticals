import { describe, expect, it, vi } from 'vitest'
import { Deferred, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import type { Account, CalEvent } from '../shared/types'
import type { AccountCache, AccountPatch } from '../accounts/store'
import type { CalendarProvider } from '../providers/types'
import { MockProvider } from '../mock/MockProvider'
import { makeSyncEngine, queryEvents, type SyncEngineShape } from './engine'
import { AuthError, fail } from '../errors'

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
  list() {
    return Effect.succeed(this.accounts)
  }
  getProvider(id: string) {
    return Effect.succeed<CalendarProvider>(this.providers.get(id)!)
  }
  readCache(id: string) {
    return Effect.succeed(this.caches.get(id) ?? { calendars: [], events: [] })
  }
  writeCache(id: string, cache: AccountCache) {
    return Effect.sync(() => {
      const before = this.caches.get(id)
      this.caches.set(id, structuredClone(cache))
      // Like the store: calendars and events only, syncedAt alone is no change.
      return !before || JSON.stringify([before.calendars, before.events]) !== JSON.stringify([cache.calendars, cache.events])
    })
  }
  update(id: string, patch: AccountPatch) {
    return Effect.sync(() => {
      const a = this.accounts.find((x) => x.id === id)!
      Object.assign(a, patch)
      return a
    })
  }
  hiddenCalendars(id: string) {
    return Effect.succeed(this.hidden.get(id) ?? [])
  }
}

function ev(id: string, calendarId: string, start: string, end: string, accountId = 'x'): CalEvent {
  return { id, accountId, calendarId, title: id, start, end, allDay: false, attendees: [] }
}

/** Lets forked passes, timers and their follow-ups run to their next wait (like flushing timers by 0 ms). */
const tick = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })
const noTriggers = (): (() => void) => () => {}
/** A provider method as the interface types it, so spies can return failures. */
const spy = <K extends 'listCalendars' | 'listEvents'>(p: MockProvider, method: K) => vi.spyOn(p as CalendarProvider, method)
const run = (self: Effect.Effect<void, unknown>): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse('2026-09-23T12:00:00Z'))
      yield* self
    }).pipe(Effect.provide(TestClock.layer()))
  )

describe('SyncEngine', () => {
  it('one failing account does not affect the other', async () => {
    const store = new FakeStore()
    const work = store.add('work')
    store.add('personal')
    work.events.push(ev('w1', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'work'))
    spy(store.providers.get('personal')!, 'listCalendars').mockReturnValue(Effect.fail(fail('401')))
    const changed = vi.fn()
    await run(Effect.gen(function* () {
      yield* (yield* makeSyncEngine(store, changed, { triggers: noTriggers })).syncNow()
    }))
    expect(store.caches.get('work')!.events.map((e) => e.id)).toEqual(['w1'])
    expect(store.accounts[1].error).toBe('401')
    expect(store.accounts[0].error).toBeUndefined()
    expect(changed).toHaveBeenCalledWith('work')
  })

  it('stamps accountId and calendarId, ignoring provider values', async () => {
    const store = new FakeStore()
    const work = store.add('work')
    work.events.push(ev('w1', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'personal'))
    spy(work, 'listEvents').mockReturnValue(Effect.succeed([ev('w1', 'other-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'personal')]))
    spy(work, 'listCalendars').mockReturnValue(Effect.succeed([{ id: 'work-cal', accountId: 'personal', name: 'C', color: '#1', readOnly: false }]))
    await run(Effect.gen(function* () {
      yield* (yield* makeSyncEngine(store, () => {}, { triggers: noTriggers })).syncNow('work')
    }))
    const cache = store.caches.get('work')!
    expect(cache.calendars[0].accountId).toBe('work')
    expect(cache.events[0]).toMatchObject({ accountId: 'work', calendarId: 'work-cal' })
  })

  it('reports syncing state around a sync', async () => {
    const store = new FakeStore()
    store.add('work')
    const seen: boolean[] = []
    await run(Effect.gen(function* () {
      const engine: SyncEngineShape = yield* makeSyncEngine(store, () => {}, { triggers: noTriggers, onSyncing: (id) => seen.push(engine.isSyncing(id)) })
      yield* engine.syncNow('work')
    }))
    expect(seen).toEqual([true, false])
  })

  it('calls onChanged only when content differs', () => {
    const store = new FakeStore()
    const work = store.add('work')
    const changed = vi.fn()
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, changed, { triggers: noTriggers })
      yield* engine.syncNow('work') // first sync: calendars appear
      expect(changed).toHaveBeenCalledTimes(1)
      yield* engine.syncNow('work')
      expect(changed).toHaveBeenCalledTimes(1)
      work.events.push(ev('w1', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z'))
      yield* engine.syncNow('work')
      expect(changed).toHaveBeenCalledTimes(2)
    }))
  })

  it('reports event notes only after the first sync and never for quiet syncs', () => {
    const store = new FakeStore()
    const work = store.add('work')
    const onEvents = vi.fn()
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, () => {}, { triggers: noTriggers, onEvents })
      const invite = (id: string): CalEvent => ({ ...ev(id, 'work-cal', '2026-09-24T09:00:00Z', '2026-09-24T10:00:00Z'), myStatus: 'needsAction' })
      work.events.push(invite('i0'))
      yield* engine.syncNow('work') // first sync: everything is "new", stay silent
      expect(onEvents).not.toHaveBeenCalled()
      work.events.push(invite('i1'))
      yield* engine.syncNow('work', { quiet: true })
      expect(onEvents).not.toHaveBeenCalled()
      work.events.push(invite('i2'))
      yield* engine.syncNow('work')
      expect(onEvents).toHaveBeenCalledExactlyOnceWith('work', [expect.objectContaining({ kind: 'invite', event: expect.objectContaining({ id: 'i2' }) })])
    }))
  })

  it('reports each sync result with the caches before and after, or the failure', () => {
    const store = new FakeStore()
    const work = store.add('work')
    const onResult = vi.fn()
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, () => {}, { triggers: noTriggers, onResult })
      yield* engine.syncNow('work')
      expect(onResult).toHaveBeenLastCalledWith('work', expect.objectContaining({ ok: true, next: expect.objectContaining({ events: [] }) }))
      expect(onResult.mock.lastCall![1].prev?.syncedAt).toBeUndefined() // never synced before
      work.events.push(ev('w1', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z'))
      yield* engine.syncNow('work')
      const last = onResult.mock.lastCall![1]
      expect(last.prev.events).toEqual([])
      expect(last.next.events.map((e: CalEvent) => e.id)).toEqual(['w1'])
      spy(work, 'listCalendars').mockReturnValue(Effect.fail(new AuthError({ message: 'expired' })))
      expect((yield* Effect.flip(engine.syncNow('work'))).message).toContain('expired')
      expect(onResult).toHaveBeenLastCalledWith('work', { ok: false, error: 'expired', auth: true })
    }))
  })

  it('does not run concurrent syncs for the same account', () => {
    const store = new FakeStore()
    const work = store.add('work')
    const calls = spy(work, 'listCalendars')
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, () => {}, { triggers: noTriggers })
      yield* Effect.all([engine.syncNow('work'), engine.syncNow('work'), engine.syncNow()], { concurrency: 'unbounded' })
      expect(calls).toHaveBeenCalledTimes(1)
    }))
  })

  it('a fresh sync runs once more after a pass already running, and that pass keeps a local edit', () => {
    const store = new FakeStore()
    const work = store.add('work')
    const gate = Deferred.makeUnsafe<void>()
    const calls = spy(work, 'listCalendars').mockReturnValueOnce(
      // this pass fetched before the edit
      Deferred.await(gate).pipe(Effect.andThen(Effect.sync(() => structuredClone(work.calendars))))
    )
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, () => {}, { triggers: noTriggers })
      const running = yield* Effect.forkChild(engine.syncNow('work'))
      yield* tick
      const local = ev('new', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z', 'work')
      store.caches.set('work', { calendars: [], events: [local] })
      engine.edited('work')
      work.events.push(local) // the server has it too
      const fresh = yield* Effect.forkChild(engine.syncNow('work', { quiet: true, fresh: true }))
      yield* tick
      const again = yield* Effect.forkChild(engine.syncNow('work', { quiet: true, fresh: true })) // shares the queued pass
      yield* tick
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(running)
      expect((yield* store.readCache('work')).events.map((e) => e.id)).toEqual(['new']) // not overwritten by the stale pass
      yield* Fiber.joinAll([fresh, again])
      expect(calls).toHaveBeenCalledTimes(2)
      expect((yield* store.readCache('work')).syncedAt).toBeDefined()
      expect((yield* store.readCache('work')).events.map((e) => e.id)).toEqual(['new'])
    }))
  })

  it('backs off exponentially per account, keeps cache, clears error on recovery', () => {
    const store = new FakeStore()
    const work = store.add('work')
    store.add('personal')
    const okSpy = spy(store.providers.get('personal')!, 'listCalendars')
    const failing = spy(work, 'listCalendars').mockReturnValue(Effect.fail(fail('down')))
    store.caches.set('work', { calendars: [], events: [ev('old', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z')] })
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, () => {}, { intervalMs: 60_000, maxBackoffMs: 5 * 60_000, triggers: noTriggers })
      const advance = (ms: number) => Effect.andThen(TestClock.adjust(ms), tick)
      yield* engine.start
      yield* tick
      expect(failing).toHaveBeenCalledTimes(1)
      expect(store.caches.get('work')!.events[0].id).toBe('old')

      yield* advance(60_000) // personal: 1 min
      expect(okSpy).toHaveBeenCalledTimes(2)
      expect(failing).toHaveBeenCalledTimes(1) // work waits 2 min
      yield* advance(60_000)
      expect(failing).toHaveBeenCalledTimes(2) // next wait 4 min
      yield* advance(3 * 60_000)
      expect(failing).toHaveBeenCalledTimes(2)
      yield* advance(60_000)
      expect(failing).toHaveBeenCalledTimes(3) // next wait capped at 5 min
      expect(store.accounts[0].error).toBe('down')

      failing.mockRestore()
      const workSpy = spy(work, 'listCalendars')
      yield* advance(5 * 60_000)
      expect(store.accounts[0].error).toBeUndefined()
      yield* engine.stop
      // No timer survives stop: an hour later nothing has synced again.
      const before = [okSpy.mock.calls.length, workSpy.mock.calls.length]
      yield* advance(60 * 60_000)
      expect([okSpy.mock.calls.length, workSpy.mock.calls.length]).toEqual(before)
    }))
  })

  it('rejected credentials: keeps cache, flags the account and stops retrying until synced on purpose', () => {
    const store = new FakeStore()
    const work = store.add('work')
    const failing = spy(work, 'listCalendars').mockReturnValue(Effect.fail(new AuthError({ message: 'revoked' })))
    const cache = { calendars: [{ id: 'work-cal', accountId: 'work', name: 'C', color: '#1', readOnly: false }], events: [ev('old', 'work-cal', '2026-09-23T09:00:00Z', '2026-09-23T10:00:00Z')] }
    store.caches.set('work', cache)
    const changed = vi.fn()
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, changed, { intervalMs: 60_000, triggers: noTriggers })
      yield* engine.start
      yield* tick
      expect(store.accounts[0]).toMatchObject({ error: 'revoked', authError: true })
      expect(store.caches.get('work')).toEqual(cache)
      expect(changed).toHaveBeenCalledWith('work')

      yield* TestClock.adjust(60 * 60_000)
      yield* tick
      yield* engine.syncNow() // e.g. window focus
      expect(failing).toHaveBeenCalledTimes(1)

      failing.mockRestore()
      yield* engine.syncNow('work') // after accounts.reauth
      expect(store.accounts[0]).toMatchObject({ error: undefined, authError: false })
      yield* engine.stop
    }))
  })

  it('replaces cached calendars with an empty list only when the next pass confirms it', () => {
    const store = new FakeStore()
    const work = store.add('work')
    spy(work, 'listCalendars').mockReturnValue(Effect.succeed([]))
    const cache = { calendars: [{ id: 'work-cal', accountId: 'work', name: 'C', color: '#1', readOnly: false }], events: [] }
    store.caches.set('work', cache)
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, () => {}, { triggers: noTriggers })
      expect((yield* Effect.flip(engine.syncNow('work'))).message).toMatch(/no calendars/)
      expect(store.caches.get('work')).toEqual(cache)
      yield* engine.syncNow('work')
      expect(store.caches.get('work')!.calendars).toEqual([])
    }))
  })

  it('syncs on trigger and stops listening after stop()', () => {
    const store = new FakeStore()
    const work = store.add('work')
    const calls = spy(work, 'listCalendars')
    let fire = (): void => {}
    const unsub = vi.fn()
    return run(Effect.gen(function* () {
      const engine = yield* makeSyncEngine(store, () => {}, {
        triggers: (f) => {
          fire = f
          return unsub
        }
      })
      yield* engine.start
      yield* tick
      fire()
      yield* tick
      expect(calls).toHaveBeenCalledTimes(2)
      yield* engine.stop
      expect(unsub).toHaveBeenCalled()
    }))
  })
})

describe('queryEvents', () => {
  it('filters by range overlap, hidden calendars and foreign accountIds', async () => {
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
    expect((await Effect.runPromise(queryEvents(store, range))).map((e) => e.id).sort()).toEqual(['in', 'overlap'])
    expect((await Effect.runPromise(queryEvents(store, range, false))).map((e) => e.id).sort()).toEqual(['hidden', 'in', 'overlap'])
  })
})
