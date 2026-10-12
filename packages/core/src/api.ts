import { Clock, Effect, Schema } from 'effect'
import type { Api } from './shared/ipc'
import type { CaldavAccountInput, CalEvent, Credentials, DeleteScope, LogEntry, LogKind, PartStat } from './shared/types'
import { AccountStore, type AccountStoreShape } from './accounts/store'
import { queryEvents, SyncEngine } from './sync/engine'
import { caldavPreset, type AccountAdded } from './telemetry'
import { conferenceUrlOf, type GEvent } from './providers/google/provider'
import { fieldChanges, snap } from './logic/activity'
import { fail, messageOf } from './errors'

/** What an api call fails with: anything with a user-facing message (typed errors, schema errors). */
export type ApiError = { readonly message: string }

export interface ApiDeps {
  verifyCaldav(input: CaldavAccountInput): Effect.Effect<{ email: string }, ApiError>
  googleSignIn(): Effect.Effect<{ email: string; credentials: Extract<Credentials, { kind: 'google' }> }, ApiError>
  /** Notify renderer that an account's data changed (visibility, label, removal). */
  onChanged?(accountId: string): void
  /** An account was added (telemetry); gets only the provider kind and CalDAV preset, never account data. */
  onAccountAdded?(info: AccountAdded): void
  /** A change the user asked for finished or failed (activity log). */
  onAction?(entry: LogEntry): void
}

/** The renderer/daemon contract as promises (what crosses IPC and the socket). */
export type CoreApi = Omit<Api, 'onChanged' | 'onMenu' | 'onSignIn'>

type Effects<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Effect.Effect<R, ApiError> : Effects<T[K]>
}
/** The same contract as effects. */
export type CoreApiEffect = Effects<CoreApi>

/** What the activity log reads before a change: the account's email and its cached events. */
export type ActivityStore = Pick<AccountStoreShape, 'get' | 'readCache'>

/** Runs every method of `api` with `run` (the app's runtime); failures reject with the same error and message. */
export function toPromiseApi(api: CoreApiEffect, run: <A>(effect: Effect.Effect<A, ApiError>) => Promise<A>): CoreApi {
  const wrap = (node: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(node).map(([k, v]) => [
        k,
        typeof v === 'function' ? (...args: unknown[]) => run((v as (...a: unknown[]) => Effect.Effect<unknown, ApiError>)(...args)) : wrap(v as Record<string, unknown>)
      ])
    )
  return wrap(api as unknown as Record<string, unknown>) as unknown as CoreApi
}

const PALETTE = ['#bd93f9', '#50fa7b', '#8be9fd', '#ff79c6', '#ffb86c', '#f1fa8c']

// ---- Trust boundary: everything from the renderer is decoded here. ----
const str = (min: number, max: number) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const id = str(1, 1024)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
/** A date (all-day) or a date-time with an offset, that is a real instant. */
const isoDateOrTime = Schema.String.check(
  Schema.makeFilter((s: string) => ((DATE.test(s) || DATE_TIME.test(s)) && !Number.isNaN(Date.parse(s))) || 'Expected an ISO date or date-time with offset')
)
const isoDate = Schema.String.check(Schema.makeFilter((s: string) => (DATE.test(s) && !Number.isNaN(Date.parse(s))) || 'Expected an ISO date'))
const color = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
const email = Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
const ordered = Schema.makeFilter((v: { start: string; end: string }) => Date.parse(v.end) >= Date.parse(v.start) || 'end before start')

/** A struct that refuses keys it doesn't declare (others just drop unknown keys). */
const strict = <F extends Schema.Struct.Fields>(fields: F) => {
  const keys = new Set(Object.keys(fields))
  return Schema.Record(Schema.String, Schema.Unknown)
    .check(Schema.makeFilter((o: Record<string, unknown>) => Object.keys(o).every((k) => keys.has(k)) || 'Unexpected key'))
    .pipe(Schema.decodeTo(Schema.Struct(fields)))
}

const Range = Schema.Struct({ start: isoDateOrTime, end: isoDateOrTime }).check(ordered)

const Recurrence = strict({
  freq: Schema.Literals(['daily', 'weekly', 'monthly', 'yearly']),
  interval: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 }))),
  byDay: Schema.optional(Schema.Array(Schema.Literals(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])).check(Schema.isMaxLength(7))),
  until: Schema.optional(isoDate),
  count: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 }))),
  // An RRULE value kept from the provider: one line of plain RRULE parts only.
  rule: Schema.optional(text(1000).check(Schema.isPattern(/^[A-Z0-9=;,+-]+$/i)))
})

const NewEvent = Schema.Struct({
  accountId: id,
  calendarId: id,
  title: text(1000),
  start: isoDateOrTime,
  end: isoDateOrTime,
  allDay: Schema.Boolean,
  location: Schema.optional(text(1000)),
  description: Schema.optional(text(20000)),
  attendees: Schema.optional(Schema.Array(email).check(Schema.isMaxLength(500))),
  recurrence: Schema.optional(Recurrence)
}).check(ordered)

// Attendees round-trip from provider data, which may hold addresses `email` rejects (e.g. user@localhost).
const Attendee = Schema.Struct({
  email: str(1, 320),
  name: Schema.optional(text(500)),
  status: Schema.Literals(['accepted', 'declined', 'tentative', 'needsAction']),
  self: Schema.optional(Schema.Boolean),
  organizer: Schema.optional(Schema.Boolean)
})

/** Only identity + editable fields; everything else (raw, etag, organizer) comes from the cache. */
const refFields = { id, accountId: id, calendarId: id }
const EventRef = Schema.Struct(refFields)
const EventEdit = Schema.Struct({
  ...refFields,
  title: text(1000),
  start: isoDateOrTime,
  end: isoDateOrTime,
  allDay: Schema.Boolean,
  location: Schema.optional(text(1000)),
  description: Schema.optional(text(20000)),
  attendees: Schema.Array(Attendee).check(Schema.isMaxLength(500)),
  // Absent keeps the series' rule; null stops repeating.
  recurrence: Schema.optional(Schema.NullishOr(Recurrence))
}).check(ordered)

const LOOPBACK = new Set(['127.0.0.1', 'localhost'])
const CaldavInput = Schema.Struct({
  label: str(1, 200),
  serverUrl: Schema.String.check(
    Schema.makeFilter((u: string) => {
      if (!URL.canParse(u)) return 'server URL must be https'
      const { protocol, hostname } = new URL(u)
      return protocol === 'https:' || (protocol === 'http:' && LOOPBACK.has(hostname)) || 'server URL must be https'
    })
  ),
  username: str(1, 500),
  password: str(1, 2000),
  color: Schema.optional(color)
})

const ReauthInput = strict({ password: str(1, 2000) })
const AccountPatch = strict({ label: Schema.optional(str(1, 200)), color: Schema.optional(color) })
const RsvpStatus = Schema.Literals(['accepted', 'declined', 'tentative'])
// null too: the terminal daemon's JSON line protocol turns an omitted argument into null.
const Scope = Schema.NullishOr(Schema.Literals(['one', 'following', 'all']))

const decode =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  (input: unknown): Effect.Effect<S['Type'], ApiError> =>
    Schema.decodeUnknownEffect(schema)(input)
const scopeOf = (raw: unknown): Effect.Effect<DeleteScope, ApiError> => Effect.map(decode(Scope)(raw), (s) => s ?? 'one')

export const createApi = (deps: ApiDeps): Effect.Effect<CoreApiEffect, never, AccountStore | SyncEngine> =>
  Effect.gen(function* () {
    const store = yield* AccountStore
    const sync = yield* SyncEngine

    const account = (accountId: unknown) =>
      Effect.gen(function* () {
        const a = yield* store.get(yield* decode(id)(accountId))
        if (!a) return yield* fail('unknown account')
        return a
      })

    /** Fire-and-forget quiet sync of exactly one account after this app changed it (no notifications). */
    const syncOne = (accountId: string): Effect.Effect<void> =>
      Effect.asVoid(
        Effect.forkDetach(
          sync.syncNow(accountId, { quiet: true, fresh: true }).pipe(Effect.catch((e) => Effect.sync(() => console.error(`sync ${accountId} failed`, e))))
        )
      )

    /** Shows an edit the provider accepted right away, instead of after the account's next sync (`syncOne`). */
    const applyLocal = (accountId: string, fn: (events: CalEvent[]) => CalEvent[]): Effect.Effect<void> =>
      store.patchCache(accountId, (c) => ({ ...c, events: fn(c.events) })).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            sync.edited(accountId)
            deps.onChanged?.(accountId)
          })
        ),
        Effect.catch((e) => Effect.sync(() => console.error(`local update of ${accountId} failed`, e))) // the sync still brings it
      )
    /** Replaces (or adds) one event, stamped with the owner like everything the sync stores. */
    const upsert = (ev: CalEvent, accountId: string, calendarId: string): Effect.Effect<void> => {
      const own = { ...ev, accountId, calendarId }
      return applyLocal(accountId, (events) => [...events.filter((e) => !sameEvent(e, own)), own])
    }

    const nextColor = Effect.map(store.list(), (all) => PALETTE[all.length % PALETTE.length])

    /** The cached copy is the source of truth for account/calendar ownership of an event. */
    const cachedEvent = (ref: { id: string; accountId: string; calendarId: string }) =>
      Effect.gen(function* () {
        yield* account(ref.accountId)
        const ev = (yield* store.readCache(ref.accountId)).events.find((e) => sameEvent(e, ref))
        if (!ev || ev.accountId !== ref.accountId || ev.calendarId !== ref.calendarId)
          return yield* fail('event does not belong to this account/calendar')
        return ev
      })

    const writable = (ev: CalEvent) =>
      Effect.gen(function* () {
        const cal = (yield* store.readCache(ev.accountId)).calendars.find((c) => c.id === ev.calendarId)
        if (!cal || cal.readOnly) return yield* fail('calendar is read-only')
        return ev
      })

    const api: CoreApiEffect = {
      accounts: {
        list: () =>
          Effect.gen(function* () {
            const all = yield* store.list()
            return yield* Effect.forEach(all, (a) =>
              Effect.map(Effect.orElseSucceed(store.readCache(a.id), () => ({ syncedAt: undefined })), (c) => ({
                ...a,
                syncing: sync.isSyncing(a.id),
                synced: !!c.syncedAt
              }))
            )
          }),
        addGoogle: () =>
          Effect.gen(function* () {
            const { email, credentials } = yield* deps.googleSignIn()
            const a = yield* store.add({ kind: 'google', label: email, email, color: yield* nextColor }, credentials)
            yield* syncOne(a.id)
            deps.onAccountAdded?.({ provider: 'google' })
            return a
          }),
        addCaldav: (raw) =>
          Effect.gen(function* () {
            const input = yield* decode(CaldavInput)(raw)
            const { email } = yield* deps.verifyCaldav(input)
            const { label, serverUrl, username, password } = input
            const a = yield* store.add(
              { kind: 'caldav', label, email, color: input.color ?? (yield* nextColor) },
              { kind: 'caldav', serverUrl, username, password }
            )
            yield* syncOne(a.id)
            deps.onAccountAdded?.({ provider: 'caldav', preset: caldavPreset(serverUrl) })
            return a
          }),
        update: (accountId, patch) =>
          Effect.gen(function* () {
            const a = yield* store.update((yield* account(accountId)).id, yield* decode(AccountPatch)(patch))
            deps.onChanged?.(a.id)
            return a
          }),
        reauth: (accountId, raw) =>
          Effect.gen(function* () {
            const a = yield* account(accountId)
            let credentials: Credentials
            if (a.kind === 'google') {
              const signed = yield* deps.googleSignIn()
              if (signed.email.toLowerCase() !== a.email.toLowerCase())
                return yield* fail(`Signed in as ${signed.email}; sign in as ${a.email} to reconnect this account`)
              credentials = signed.credentials
            } else {
              const { password } = yield* decode(ReauthInput)(raw)
              const old = yield* store.readCreds(a.id)
              if (old.kind !== 'caldav') return yield* fail('Credentials kind does not match account kind')
              yield* deps.verifyCaldav({ label: a.label, serverUrl: old.serverUrl, username: old.username, password })
              credentials = { ...old, password }
            }
            const updated = yield* store.update(a.id, { credentials, error: undefined, authError: false })
            deps.onChanged?.(a.id)
            yield* syncOne(a.id)
            return updated
          }),
        remove: (accountId) =>
          Effect.gen(function* () {
            const a = yield* account(accountId)
            yield* store.remove(a.id)
            deps.onChanged?.(a.id)
          })
      },
      calendars: {
        list: () =>
          Effect.gen(function* () {
            const lists = yield* Effect.forEach(yield* store.list(), (a) =>
              Effect.gen(function* () {
                const hidden = new Set(yield* store.hiddenCalendars(a.id))
                const cache = yield* Effect.orElseSucceed(store.readCache(a.id), () => ({ calendars: [] }))
                return cache.calendars.map((c) => ({ ...c, accountId: a.id, visible: !hidden.has(c.id) }))
              })
            )
            return lists.flat()
          }),
        setVisible: (accountId, calendarId, visible) =>
          Effect.gen(function* () {
            const a = yield* account(accountId)
            const cal = yield* decode(id)(calendarId)
            if (!(yield* store.readCache(a.id)).calendars.some((c) => c.id === cal)) return yield* fail('calendar does not belong to account')
            yield* store.setCalendarVisible(a.id, cal, yield* decode(Schema.Boolean)(visible))
            deps.onChanged?.(a.id)
          })
      },
      events: {
        // `raw` stays in the daemon/main process: it can be huge (CalDAV series ICS) and writes re-read it from the cache.
        // Caches synced before `conferenceUrl` existed still hold the Meet link in the Google resource.
        list: (raw) =>
          Effect.gen(function* () {
            const events = yield* queryEvents(store, yield* decode(Range)(raw), false)
            return events.map(({ raw: r, ...e }) =>
              e.conferenceUrl || !r || typeof r !== 'object' ? e : { ...e, conferenceUrl: conferenceUrlOf(r as GEvent) }
            )
          }),
        create: (raw) =>
          Effect.gen(function* () {
            const input = yield* decode(NewEvent)(raw)
            const a = yield* account(input.accountId)
            const cal = (yield* store.readCache(a.id)).calendars.find((c) => c.id === input.calendarId)
            if (!cal) return yield* fail('calendar does not belong to account')
            if (cal.readOnly) return yield* fail('calendar is read-only')
            const provider = yield* store.getProvider(a.id)
            const ev = yield* provider.createEvent(cal.id, {
              ...input,
              accountId: a.id,
              attendees: input.attendees && [...input.attendees],
              recurrence: input.recurrence && { ...input.recurrence, byDay: input.recurrence.byDay && [...input.recurrence.byDay] }
            })
            yield* upsert(ev, a.id, cal.id)
            yield* syncOne(a.id)
            return ev
          }),
        update: (raw, scope) =>
          Effect.gen(function* () {
            const edit = yield* decode(EventEdit)(raw)
            const cached = yield* writable(yield* cachedEvent(edit))
            const how: DeleteScope = cached.recurringEventId ? yield* scopeOf(scope) : 'one'
            const { title, start, end, allDay, location, description } = edit
            const attendees = edit.attendees.map((a) => ({ ...a }))
            const recurrence = edit.recurrence && { ...edit.recurrence, byDay: edit.recurrence.byDay && [...edit.recurrence.byDay] }
            if (edit.recurrence !== undefined && cached.recurringEventId && how === 'one')
              return yield* fail('The repeat rule belongs to the series: choose “This and following” or “All events”')
            const provider = yield* store.getProvider(cached.accountId)
            const ev = yield* provider.updateEvent(
              { ...cached, title, start, end, allDay, location, description, attendees, ...(edit.recurrence !== undefined ? { recurrence } : {}) },
              how
            )
            if (how === 'one') yield* upsert(ev, cached.accountId, cached.calendarId)
            else {
              // The series' other instances moved or split; drop the stale ones until the sync below refills them.
              const own = { ...ev, accountId: cached.accountId, calendarId: cached.calendarId }
              yield* applyLocal(cached.accountId, (events) => [...events.filter((e) => !sameEvent(e, own) && !deletedBy(cached, how, e)), own])
            }
            yield* syncOne(cached.accountId)
            return ev
          }),
        delete: (raw, scope) =>
          Effect.gen(function* () {
            const cached = yield* writable(yield* cachedEvent(yield* decode(EventRef)(raw)))
            const how = yield* scopeOf(scope)
            const provider = yield* store.getProvider(cached.accountId)
            yield* provider.deleteEvent(cached, how)
            yield* applyLocal(cached.accountId, (events) => events.filter((e) => !deletedBy(cached, how, e)))
            yield* syncOne(cached.accountId)
          }),
        recurrence: (raw) =>
          Effect.gen(function* () {
            const cached = yield* cachedEvent(yield* decode(EventRef)(raw))
            const provider = yield* store.getProvider(cached.accountId)
            return yield* provider.getRecurrence(cached)
          }),
        respond: (raw, status) =>
          Effect.gen(function* () {
            const cached = yield* cachedEvent(yield* decode(EventRef)(raw))
            const provider = yield* store.getProvider(cached.accountId)
            const ev = yield* provider.respond(cached, yield* decode(RsvpStatus)(status))
            yield* upsert(ev, cached.accountId, cached.calendarId)
            yield* syncOne(cached.accountId)
            return ev
          })
      },
      sync: {
        now: (accountId) =>
          Effect.gen(function* () {
            if (accountId === undefined || accountId === null) return yield* sync.syncNow()
            return yield* sync.syncNow((yield* account(accountId)).id)
          })
      }
    }
    return deps.onAction ? withActivityLog(api, store, deps.onAction) : api
  })

/** One account's copy of an event: a meeting shown in two of its calendars has the same id in both. */
const sameEvent = (a: Pick<CalEvent, 'id' | 'calendarId'>, b: Pick<CalEvent, 'id' | 'calendarId'>): boolean =>
  a.id === b.id && a.calendarId === b.calendarId

/** Whether deleting `target` with `scope` removes `e` (a recurring series' other instances for 'all'/'following'). */
export function deletedBy(target: CalEvent, scope: DeleteScope, e: CalEvent): boolean {
  if (sameEvent(e, target)) return true
  const series = target.recurringEventId
  if (!series || scope === 'one' || e.recurringEventId !== series || e.calendarId !== target.calendarId) return false
  return scope === 'all' || Date.parse(e.start) >= Date.parse(target.start)
}

/**
 * The same API, recording every change the user asks for (accounts, calendars, events) with its outcome. Reads the
 * cached event before the change, so the entry holds what it was; inputs are still validated by `api` itself.
 */
export function withActivityLog(api: CoreApiEffect, store: ActivityStore, onAction: (e: LogEntry) => void): CoreApiEffect {
  const field = (raw: unknown, k: string): string => {
    const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[k] : undefined
    return typeof v === 'string' ? v : ''
  }
  const cached = (raw: unknown): Effect.Effect<CalEvent | undefined> =>
    store.readCache(field(raw, 'accountId')).pipe(
      Effect.map((c) => c.events.find((e) => e.id === field(raw, 'id') && e.calendarId === field(raw, 'calendarId'))),
      Effect.orElseSucceed(() => undefined)
    )
  const run = <T>(
    kind: LogKind,
    accountId: string,
    entry: Partial<LogEntry> | Effect.Effect<Partial<LogEntry>>,
    self: Effect.Effect<T, ApiError>,
    after?: (r: T) => Partial<LogEntry>
  ): Effect.Effect<T, ApiError> =>
    Effect.gen(function* () {
      const extra = Effect.isEffect(entry) ? yield* entry : entry
      const at = new Date(yield* Clock.currentTimeMillis).toISOString()
      const base = { at, accountId, email: (yield* store.get(accountId))?.email ?? '', kind, ...extra }
      return yield* self.pipe(
        Effect.tap((r) => Effect.sync(() => onAction({ ...base, ok: true, ...after?.(r) }))),
        Effect.tapError((e) => Effect.sync(() => onAction({ ...base, ok: false, error: messageOf(e) })))
      )
    })
  const added = (a: { id: string; email: string; label: string }): Partial<LogEntry> => ({ accountId: a.id, email: a.email, detail: { label: a.label } })

  return {
    ...api,
    accounts: {
      ...api.accounts,
      addGoogle: () => run('account.add', '', { detail: { provider: 'google' } }, api.accounts.addGoogle(), added),
      addCaldav: (raw) => run('account.add', '', { email: field(raw, 'username'), detail: { provider: 'caldav' } }, api.accounts.addCaldav(raw), added),
      update: (accountId, patch) =>
        run(
          'account.update',
          String(accountId),
          Effect.map(store.get(String(accountId)), (a) => ({
            changes: (['label', 'color'] as const).flatMap((f) => {
              const to = field(patch, f)
              return a && to && to !== a[f] ? [{ field: f, from: a[f], to }] : []
            })
          })),
          api.accounts.update(accountId, patch)
        ),
      reauth: (accountId, raw) => run('account.reauth', String(accountId), {}, api.accounts.reauth(accountId, raw)),
      remove: (accountId) =>
        run(
          'account.remove',
          String(accountId),
          Effect.map(store.get(String(accountId)), (a) => ({ detail: { label: a?.label ?? '' } })),
          api.accounts.remove(accountId)
        )
    },
    calendars: {
      ...api.calendars,
      setVisible: (accountId, calendarId, visible) =>
        run(
          'calendar.visible',
          String(accountId),
          store.readCache(String(accountId)).pipe(
            Effect.map((c) => c.calendars.find((x) => x.id === calendarId)?.name ?? String(calendarId)),
            // unknown account: api.calendars.setVisible refuses it
            Effect.orElseSucceed(() => String(calendarId)),
            Effect.map((name) => ({ detail: { calendar: name, visible: visible === true } }))
          ),
          api.calendars.setVisible(accountId, calendarId, visible)
        )
    },
    events: {
      ...api.events,
      create: (raw) => run('event.create', field(raw, 'accountId'), {}, api.events.create(raw), (ev) => ({ event: snap(ev) })),
      update: (raw, scope) =>
        Effect.flatMap(cached(raw), (old) => {
          const recurrence = raw && typeof raw === 'object' ? (raw as Partial<CalEvent>).recurrence : undefined
          return run(
            'event.update',
            field(raw, 'accountId'),
            { event: old && snap(old), scope: old?.recurringEventId ? (scope ?? 'one') : undefined },
            api.events.update(raw, scope),
            (ev) => ({ event: snap(ev), changes: old ? fieldChanges(old, { ...ev, recurrence }) : undefined })
          )
        }),
      delete: (raw, scope) =>
        Effect.flatMap(cached(raw), (old) =>
          run('event.delete', field(raw, 'accountId'), { event: old && snap(old), scope: scope ?? 'one' }, api.events.delete(raw, scope))
        ),
      respond: (raw, status) =>
        Effect.flatMap(cached(raw), (old) =>
          run(
            'event.respond',
            field(raw, 'accountId'),
            { event: old && snap(old), status: status as PartStat },
            api.events.respond(raw, status),
            (ev) => ({ event: snap(ev) })
          )
        )
    }
  }
}
