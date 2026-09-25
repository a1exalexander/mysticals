import { addMonths, parseISO, subMonths } from 'date-fns'
import type { CalEvent, TimeRange } from '../shared/types'
import type { AccountCache, AccountStore } from '../accounts/store'
import { diffEvents, type Note } from './notify'

/** The slice of AccountStore the engine needs. Keeps tests free of disk. */
export type SyncStore = Pick<AccountStore, 'list' | 'getProvider' | 'readCache' | 'writeCache' | 'update'>

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
}

const MIN = 60_000

export class SyncEngine {
  private readonly intervalMs: number
  private readonly maxBackoffMs: number
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inflight = new Map<string, Promise<void>>()
  private failures = new Map<string, number>()
  /** Follow-up passes queued behind a running one (see `fresh`). */
  private queued = new Map<string, Promise<void>>()
  /** Bumped by `edited`: a pass that started before a local edit must not overwrite it. */
  private edits = new Map<string, number>()
  private running = false
  private unsubscribe?: () => void

  constructor(
    readonly store: SyncStore,
    readonly onChanged: (accountId: string) => void,
    private readonly opts: SyncOptions = {}
  ) {
    this.intervalMs = opts.intervalMs ?? 2 * MIN
    this.maxBackoffMs = opts.maxBackoffMs ?? 30 * MIN
  }

  start(): void {
    if (this.running) return
    this.running = true
    const fire = (): void => void this.syncNow()
    this.unsubscribe = this.opts.triggers?.(fire)
    void this.syncNow()
  }

  stop(): void {
    this.running = false
    this.unsubscribe?.()
    this.unsubscribe = undefined
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  /**
   * Sync one account, or all accounts independently when id omitted.
   * A single-account call rejects with that account's error; the all-accounts call never rejects.
   */
  /**
   * `quiet`: the change came from this app (own edit/RSVP), so don't notify about it.
   * `fresh`: the caller just changed the account on the server, so a pass already running (it may have fetched
   * before the change) is followed by one more instead of being reused.
   */
  async syncNow(accountId?: string, opts: { quiet?: boolean; fresh?: boolean } = {}): Promise<void> {
    if (accountId === undefined) {
      await Promise.allSettled(this.store.list().map((a) => this.syncNow(a.id)))
      return
    }
    const existing = this.inflight.get(accountId)
    if (existing && !opts.fresh) return existing
    if (existing) {
      let next = this.queued.get(accountId)
      if (!next) {
        next = existing
          .catch(() => {})
          .then(() => {
            this.queued.delete(accountId)
            return this.syncNow(accountId, { quiet: opts.quiet })
          })
        this.queued.set(accountId, next)
      }
      return next
    }
    const p = this.syncAccount(accountId, !!opts.quiet).finally(() => {
      this.inflight.delete(accountId)
      this.schedule(accountId)
      this.opts.onSyncing?.(accountId)
    })
    this.inflight.set(accountId, p)
    this.opts.onSyncing?.(accountId)
    return p
  }

  /** A local edit was applied to this account's cache; a pass already running won't overwrite it. */
  edited(accountId: string): void {
    this.edits.set(accountId, (this.edits.get(accountId) ?? 0) + 1)
  }

  /** True while a sync of this account is running. */
  isSyncing(accountId: string): boolean {
    return this.inflight.has(accountId)
  }

  /** (Re)arms this account's own timer: normal interval, or backoff after failures. */
  private schedule(id: string): void {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    if (!this.running || !this.store.list().some((a) => a.id === id)) {
      this.failures.delete(id)
      return
    }
    const n = this.failures.get(id) ?? 0
    const delay = n === 0 ? this.intervalMs : Math.min(this.intervalMs * 2 ** n, this.maxBackoffMs)
    this.timers.set(
      id,
      setTimeout(() => void this.syncNow(id).catch(() => {}), delay)
    )
  }

  // ponytail: quiet silences the whole sync, so an external change landing in the same pass is not announced.
  private async syncAccount(id: string, quiet: boolean): Promise<void> {
    const hadError = !!this.store.list().find((a) => a.id === id)?.error
    const edits = this.edits.get(id) ?? 0
    try {
      const provider = this.store.getProvider(id)
      const now = new Date()
      const range: TimeRange = { start: subMonths(now, 3).toISOString(), end: addMonths(now, 3).toISOString() }
      // Never trust provider ids: everything stored under this account is stamped with it.
      const calendars = (await provider.listCalendars()).map((c) => ({ ...c, accountId: id }))
      const lists = await Promise.all(
        calendars.map(async (cal) =>
          (await provider.listEvents(cal.id, range)).map((e) => ({ ...e, accountId: id, calendarId: cal.id }))
        )
      )
      const next: AccountCache = { calendars, events: lists.flat(), syncedAt: now.toISOString() }
      // Fetched before a local edit: keep the edit; the edit's own `fresh` pass brings the server's copy.
      if ((this.edits.get(id) ?? 0) !== edits) {
        this.failures.delete(id)
        return
      }

      let prev: AccountCache | undefined
      try {
        prev = this.store.readCache(id)
      } catch {
        prev = undefined
      }
      const changed =
        !prev || JSON.stringify([prev.calendars, prev.events]) !== JSON.stringify([next.calendars, next.events])
      await this.store.writeCache(id, next)
      this.failures.delete(id)
      if (hadError) await this.store.update(id, { error: undefined })
      if (changed || hadError) this.onChanged(id)
      if (changed && !quiet && prev?.syncedAt && this.opts.onEvents) {
        const notes = diffEvents(prev.events, next.events, now)
        if (notes.length) this.opts.onEvents(id, notes)
      }
    } catch (e) {
      // Cache is left untouched; only this account backs off.
      this.failures.set(id, (this.failures.get(id) ?? 0) + 1)
      const message = e instanceof Error ? e.message : String(e)
      await this.store.update(id, { error: message }).catch(() => {})
      if (!hadError) this.onChanged(id)
      throw e
    }
  }
}

/**
 * Events from every account's cache that overlap `range` (end-exclusive).
 * With `visibleOnly` (default), events in calendars hidden via `store.hiddenCalendars(id)` are skipped.
 */
export function queryEvents(
  store: Pick<AccountStore, 'list' | 'readCache' | 'hiddenCalendars'>,
  range: TimeRange,
  visibleOnly = true
): CalEvent[] {
  const from = parseISO(range.start).getTime()
  const to = parseISO(range.end).getTime()
  const out: CalEvent[] = []
  for (const acc of store.list()) {
    let cache: AccountCache
    try {
      cache = store.readCache(acc.id)
    } catch {
      continue
    }
    const hidden = new Set(visibleOnly ? store.hiddenCalendars(acc.id) : [])
    for (const e of cache.events) {
      // parseISO reads date-only (all-day) values as local midnight.
      if (e.accountId !== acc.id || hidden.has(e.calendarId)) continue
      if (parseISO(e.end).getTime() > from && parseISO(e.start).getTime() < to) out.push(e)
    }
  }
  return out
}
