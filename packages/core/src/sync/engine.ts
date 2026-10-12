import { addMonths, parseISO, subMonths } from 'date-fns'
import { Cause, Clock, Context, Deferred, Effect, Exit, FiberMap, Layer, Queue, Scope, Stream } from 'effect'
import type { CalEvent, TimeRange } from '../shared/types'
import { AccountStore, type AccountCache, type AccountStoreShape } from '../accounts/store'
import { diffEvents, type Note } from './notify'
import { AuthError, messageOf, type AppError } from '../errors'

/** The slice of AccountStore the engine needs. Keeps tests free of disk. */
export type SyncStore = Pick<AccountStoreShape, 'list' | 'getProvider' | 'readCache' | 'writeCache' | 'update'>

/** Subscribes `fire` to external wake-ups (resume, focus). Returns an unsubscribe. */
export type Triggers = (fire: () => void) => () => void

export interface SyncOptions {
  /** Regular per-account interval. Default 2 min. */
  intervalMs?: number
  /** Backoff cap after failures. Default 30 min. */
  maxBackoffMs?: number
  /** Wake-up sources (e.g. resume from sleep, window focus). Default: none. */
  triggers?: Triggers
  /** Noteworthy event changes found by a (non-quiet) sync after the account's first one. */
  onEvents?: (accountId: string, notes: Note[]) => void
  /** An account started or finished syncing (see `isSyncing`). */
  onSyncing?: (accountId: string) => void
  /** Every finished sync of an account: the caches before and after, or why it failed (activity log). */
  onResult?: (accountId: string, result: SyncResult) => void
}

export type SyncResult = { ok: true; prev?: AccountCache; next: AccountCache } | { ok: false; error: string; auth: boolean }

/** Why one account's sync failed: the provider's typed error, or anything a pass threw. */
export type SyncError = { readonly message: string }

export interface SyncEngineShape {
  /** Syncs everything now, then keeps each account on its own timer and listens to the triggers. Idempotent. */
  readonly start: Effect.Effect<void>
  /** Stops timers, triggers and passes still running (they never write the cache after it). */
  readonly stop: Effect.Effect<void>
  /**
   * Sync one account, or all accounts independently when id omitted.
   * A single-account call fails with that account's error; the all-accounts call never fails.
   * The all-accounts call skips accounts whose credentials were rejected (`authError`): retrying can't help.
   * `quiet`: the change came from this app (own edit/RSVP), so don't notify about it.
   * `fresh`: the caller just changed the account on the server, so a pass already running (it may have fetched
   * before the change) is followed by one more instead of being reused.
   */
  syncNow(accountId?: string, opts?: { quiet?: boolean; fresh?: boolean }): Effect.Effect<void, SyncError>
  /** A local edit was applied to this account's cache; a pass already running won't overwrite it. */
  edited(accountId: string): void
  /** True while a sync of this account is running. */
  isSyncing(accountId: string): boolean
}

export class SyncEngine extends Context.Service<SyncEngine, SyncEngineShape>()('mysticals/SyncEngine') {
  /** The engine over the app's AccountStore; stopped when the layer's scope closes. */
  static readonly layer = (onChanged: (accountId: string) => void, opts?: SyncOptions) =>
    Layer.effect(
      SyncEngine,
      Effect.gen(function* () {
        const store = yield* AccountStore
        return yield* Effect.acquireRelease(makeSyncEngine(store, onChanged, opts), (engine) => engine.stop)
      })
    )
}

const MIN = 60_000
/** Accounts synced at once by the all-accounts call, and calendars listed at once per account. */
const ACCOUNTS_AT_ONCE = 3
const CALENDARS_AT_ONCE = 4

/** Whether a pass changed anything; compares item by item so a big unchanged cache stops at the first difference. */
const sameCache = (a: AccountCache, b: AccountCache): boolean =>
  a.calendars.length === b.calendars.length &&
  a.events.length === b.events.length &&
  JSON.stringify(a.calendars) === JSON.stringify(b.calendars) &&
  a.events.every((e, i) => JSON.stringify(e) === JSON.stringify(b.events[i]))

/** Passes, timers and the trigger listener run in the engine's own scope, which `stop` closes. */
export const makeSyncEngine = (store: SyncStore, onChanged: (accountId: string) => void, opts: SyncOptions = {}): Effect.Effect<SyncEngineShape> =>
  Effect.gen(function* () {
    const intervalMs = opts.intervalMs ?? 2 * MIN
    const maxBackoffMs = opts.maxBackoffMs ?? 30 * MIN
    let scope = yield* Scope.make()
    let timers = yield* FiberMap.make<string>().pipe(Scope.provide(scope))
    const inflight = new Map<string, Deferred.Deferred<void, SyncError>>()
    const failures = new Map<string, number>()
    /** Follow-up passes queued behind a running one (see `fresh`). */
    const queued = new Map<string, Deferred.Deferred<void, SyncError>>()
    /** Bumped by `edited`: a pass that started before a local edit must not overwrite it. */
    const edits = new Map<string, number>()
    /** Accounts whose last pass listed no calendars while the cache had some (see syncAccount). */
    const emptied = new Set<string>()
    let running = false

    /** Runs `self` in the engine's scope, so `stop` interrupts it, and hands its result to `done`. */
    const background = <A, E>(self: Effect.Effect<A, E>, done: Deferred.Deferred<A, E>): Effect.Effect<void> =>
      Effect.asVoid(Effect.forkIn(self.pipe(Effect.onExit((exit) => Deferred.done(done, exit))), scope))

    /** (Re)arms this account's own timer: normal interval, or backoff after failures. */
    const schedule = (id: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* FiberMap.remove(timers, id)
        // Rejected credentials: no timer until accounts.reauth saves new ones and syncs.
        const acc = (yield* store.list()).find((a) => a.id === id)
        if (!running || !acc || acc.authError) {
          failures.delete(id)
          return
        }
        const n = failures.get(id) ?? 0
        const delay = n === 0 ? intervalMs : Math.min(intervalMs * 2 ** n, maxBackoffMs)
        yield* FiberMap.run(timers, id, Effect.sleep(delay).pipe(Effect.andThen(Effect.ignore(syncNow(id)))))
      })

    // ponytail: quiet silences the whole sync, so an external change landing in the same pass is not announced.
    const syncAccount = (id: string, quiet: boolean): Effect.Effect<void, SyncError> =>
      Effect.gen(function* () {
        const acc = (yield* store.list()).find((a) => a.id === id)
        const hadError = !!acc?.error
        const before = edits.get(id) ?? 0
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const provider = yield* store.getProvider(id)
            const now = new Date(yield* Clock.currentTimeMillis)
            const range: TimeRange = { start: subMonths(now, 3).toISOString(), end: addMonths(now, 3).toISOString() }
            // Never trust provider ids: everything stored under this account is stamped with it.
            const calendars = (yield* provider.listCalendars()).map((c) => ({ ...c, accountId: id }))
            const lists = yield* Effect.forEach(
              calendars,
              (cal) => provider.listEvents(cal.id, range).pipe(Effect.map((events) => events.map((e) => ({ ...e, accountId: id, calendarId: cal.id })))),
              { concurrency: CALENDARS_AT_ONCE }
            )
            const next: AccountCache = { calendars, events: lists.flat(), syncedAt: now.toISOString() }
            // Fetched before a local edit: keep the edit; the edit's own `fresh` pass brings the server's copy.
            if ((edits.get(id) ?? 0) !== before) {
              failures.delete(id)
              return
            }

            const prev = yield* Effect.option(store.readCache(id)).pipe(Effect.map((o) => (o._tag === 'Some' ? o.value : undefined)))
            // A server that suddenly lists no calendars is more likely failing than emptied: keep the cache until the
            // next pass confirms it.
            if (!calendars.length && prev?.calendars.length && !emptied.has(id)) {
              emptied.add(id)
              return yield* Effect.fail({ message: 'The server returned no calendars; showing the last synced data' })
            }
            emptied.delete(id)
            const changed = !prev || !sameCache(prev, next)
            yield* store.writeCache(id, next)
            failures.delete(id)
            opts.onResult?.(id, { ok: true, prev, next })
            if (hadError) yield* store.update(id, { error: undefined, authError: false })
            if (changed || hadError) onChanged(id)
            if (changed && !quiet && prev?.syncedAt && opts.onEvents) {
              const notes = diffEvents(prev.events, next.events, now)
              if (notes.length) opts.onEvents(id, notes)
            }
          })
        )
        if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return yield* exit
        // Cache is left untouched; only this account backs off (or, with rejected credentials, stops: see `schedule`).
        const e = Cause.squash(exit.cause)
        failures.set(id, (failures.get(id) ?? 0) + 1)
        const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : messageOf(e)
        const auth = e instanceof AuthError
        yield* Effect.ignore(store.update(id, { error: message, ...(auth ? { authError: true } : {}) }))
        if (!hadError || (auth && !acc?.authError)) onChanged(id)
        opts.onResult?.(id, { ok: false, error: message, auth })
        return yield* Effect.fail<SyncError>(e instanceof Error ? e : { message })
      })

    const syncNow = (accountId?: string, o: { quiet?: boolean; fresh?: boolean } = {}): Effect.Effect<void, SyncError> =>
      Effect.suspend(() => {
        if (accountId === undefined)
          return Effect.flatMap(store.list(), (accounts) =>
            Effect.forEach(
              accounts.filter((a) => !a.authError),
              (a) => Effect.ignore(syncNow(a.id)),
              { concurrency: ACCOUNTS_AT_ONCE, discard: true }
            )
          )
        const existing = inflight.get(accountId)
        if (existing && !o.fresh) return Deferred.await(existing)
        if (existing) {
          let next = queued.get(accountId)
          if (!next) {
            const done = (next = Deferred.makeUnsafe<void, SyncError>())
            queued.set(accountId, done)
            const follow = Deferred.await(existing).pipe(
              Effect.ignore,
              Effect.andThen(
                Effect.suspend(() => {
                  queued.delete(accountId)
                  return syncNow(accountId, { quiet: o.quiet })
                })
              )
            )
            return Effect.andThen(background(follow, done), Deferred.await(done))
          }
          return Deferred.await(next)
        }
        const done = Deferred.makeUnsafe<void, SyncError>()
        inflight.set(accountId, done)
        opts.onSyncing?.(accountId)
        const pass = syncAccount(accountId, !!o.quiet).pipe(
          Effect.onExit(() =>
            Effect.suspend(() => {
              inflight.delete(accountId)
              return schedule(accountId)
            }).pipe(Effect.andThen(Effect.sync(() => opts.onSyncing?.(accountId))))
          )
        )
        return Effect.andThen(background(pass, done), Deferred.await(done))
      })

    const triggers = opts.triggers
    const engine: SyncEngineShape = {
      start: Effect.suspend(() => {
        if (running) return Effect.void
        running = true
        const wakeUps = Stream.callback<void>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => triggers?.(() => void Queue.offerUnsafe(queue, undefined))),
            (unsubscribe) => Effect.sync(() => unsubscribe?.())
          )
        )
        return Effect.all(
          [Effect.forkIn(Stream.runForEach(wakeUps, () => syncNow()), scope), background(syncNow(), Deferred.makeUnsafe())],
          { discard: true }
        )
      }),
      stop: Effect.gen(function* () {
        running = false
        const old = scope
        scope = yield* Scope.make()
        timers = yield* FiberMap.make<string>().pipe(Scope.provide(scope))
        yield* Scope.close(old, Exit.void)
        inflight.clear()
        queued.clear()
      }),
      syncNow,
      edited: (accountId) => void edits.set(accountId, (edits.get(accountId) ?? 0) + 1),
      isSyncing: (accountId) => inflight.has(accountId)
    }
    return engine
  })

/**
 * Events from every account's cache that overlap `range` (end-exclusive).
 * With `visibleOnly` (default), events in calendars hidden via `store.hiddenCalendars(id)` are skipped.
 */
export const queryEvents = (
  store: Pick<AccountStoreShape, 'list' | 'readCache' | 'hiddenCalendars'>,
  range: TimeRange,
  visibleOnly = true
): Effect.Effect<CalEvent[], AppError> =>
  Effect.gen(function* () {
    const from = parseISO(range.start).getTime()
    const to = parseISO(range.end).getTime()
    const out: CalEvent[] = []
    for (const acc of yield* store.list()) {
      const cache = yield* Effect.option(store.readCache(acc.id))
      if (cache._tag === 'None') continue
      const hidden = new Set(visibleOnly ? yield* store.hiddenCalendars(acc.id) : [])
      for (const e of cache.value.events) {
        // parseISO reads date-only (all-day) values as local midnight.
        if (e.accountId !== acc.id || hidden.has(e.calendarId)) continue
        if (parseISO(e.end).getTime() > from && parseISO(e.start).getTime() < to) out.push(e)
      }
    }
    return out
  })
