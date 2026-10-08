import { z } from 'zod'
import type { Api } from './shared/ipc'
import type { CaldavAccountInput, CalEvent, Credentials, LogEntry, LogKind, PartStat } from './shared/types'
import type { AccountStore } from './accounts/store'
import { queryEvents, type SyncEngine } from './sync/engine'
import { caldavPreset, type AccountAdded } from './telemetry'
import { conferenceUrlOf, type GEvent } from './providers/google/provider'
import { fieldChanges, snap } from './logic/activity'

export interface ApiDeps {
  verifyCaldav(input: CaldavAccountInput): Promise<{ email: string }>
  googleSignIn(): Promise<{ email: string; credentials: Extract<Credentials, { kind: 'google' }> }>
  /** Notify renderer that an account's data changed (visibility, label, removal). */
  onChanged?(accountId: string): void
  /** An account was added (telemetry); gets only the provider kind and CalDAV preset, never account data. */
  onAccountAdded?(info: AccountAdded): void
  /** A change the user asked for finished or failed (activity log). */
  onAction?(entry: LogEntry): void
}

export type CoreApi = Omit<Api, 'onChanged' | 'onMenu' | 'onSignIn'>
/** What the activity log reads before a change: the account's email and its cached events. */
export type ActivityStore = Pick<AccountStore, 'get' | 'readCache'>

const PALETTE = ['#bd93f9', '#50fa7b', '#8be9fd', '#ff79c6', '#ffb86c', '#f1fa8c']

// ---- Trust boundary: everything from the renderer is parsed here. ----
const id = z.string().min(1).max(1024)
const isoDateOrTime = z.union([z.iso.datetime({ offset: true }), z.iso.date()])
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const text = (max: number) => z.string().max(max)
const ordered = <T extends { start: string; end: string }>(v: T): boolean => Date.parse(v.end) >= Date.parse(v.start)

const Range = z.object({ start: isoDateOrTime, end: isoDateOrTime }).refine(ordered, 'end before start')

const Recurrence = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(999).optional(),
    byDay: z.array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])).max(7).optional(),
    until: z.iso.date().optional(),
    count: z.number().int().min(1).max(999).optional(),
    // An RRULE value kept from the provider: one line of plain RRULE parts only.
    rule: z.string().max(1000).regex(/^[A-Z0-9=;,+-]+$/i).optional()
  })
  .strict()

const NewEvent = z
  .object({
    accountId: id,
    calendarId: id,
    title: text(1000),
    start: isoDateOrTime,
    end: isoDateOrTime,
    allDay: z.boolean(),
    location: text(1000).optional(),
    description: text(20000).optional(),
    attendees: z.array(z.email()).max(500).optional(),
    recurrence: Recurrence.optional()
  })
  .refine(ordered, 'end before start')

// Attendees round-trip from provider data, which may hold addresses z.email() rejects (e.g. user@localhost).
const Attendee = z.object({
  email: text(320).min(1),
  name: text(500).optional(),
  status: z.enum(['accepted', 'declined', 'tentative', 'needsAction']),
  self: z.boolean().optional(),
  organizer: z.boolean().optional()
})

/** Only identity + editable fields; everything else (raw, etag, organizer) comes from the cache. */
const EventRef = z.object({ id, accountId: id, calendarId: id })
const EventEdit = EventRef.extend({
  title: text(1000),
  start: isoDateOrTime,
  end: isoDateOrTime,
  allDay: z.boolean(),
  location: text(1000).optional(),
  description: text(20000).optional(),
  attendees: z.array(Attendee).max(500),
  // Absent keeps the series' rule; null stops repeating.
  recurrence: Recurrence.nullish()
}).refine(ordered, 'end before start')

const LOOPBACK = new Set(['127.0.0.1', 'localhost'])
const CaldavInput = z.object({
  label: text(200).min(1),
  serverUrl: z.string().refine((u) => {
    if (!URL.canParse(u)) return false
    const { protocol, hostname } = new URL(u)
    return protocol === 'https:' || (protocol === 'http:' && LOOPBACK.has(hostname))
  }, 'server URL must be https'),
  username: text(500).min(1),
  password: text(2000).min(1),
  color: color.optional()
})

const ReauthInput = z.object({ password: text(2000).min(1) }).strict()
const AccountPatch = z.object({ label: text(200).min(1).optional(), color: color.optional() }).strict()
const RsvpStatus = z.enum(['accepted', 'declined', 'tentative'])
// null too: the terminal daemon's JSON line protocol turns an omitted argument into null.
const Scope = z.enum(['one', 'following', 'all']).nullish().transform((s) => s ?? 'one')

export function createApi(store: AccountStore, sync: SyncEngine, deps: ApiDeps): CoreApi {
  const account = (accountId: unknown) => {
    const a = store.get(id.parse(accountId))
    if (!a) throw new Error('unknown account')
    return a
  }

  /** Fire-and-forget quiet sync of exactly one account after this app changed it (no notifications). */
  const syncOne = (accountId: string): void => {
    sync.syncNow(accountId, { quiet: true, fresh: true }).catch((e) => console.error(`sync ${accountId} failed`, e))
  }

  /** Shows an edit the provider accepted right away, instead of after the account's next sync (`syncOne`). */
  const applyLocal = (accountId: string, fn: (events: CalEvent[]) => CalEvent[]): void => {
    try {
      store.patchCache(accountId, (c) => ({ ...c, events: fn(c.events) }))
      sync.edited(accountId)
      deps.onChanged?.(accountId)
    } catch (e) {
      console.error(`local update of ${accountId} failed`, e) // the sync still brings it
    }
  }
  /** Replaces (or adds) one event, stamped with the owner like everything the sync stores. */
  const upsert = (ev: CalEvent, accountId: string, calendarId: string): void => {
    const own = { ...ev, accountId, calendarId }
    applyLocal(accountId, (events) => [...events.filter((e) => e.id !== own.id), own])
  }

  const nextColor = (): string => PALETTE[store.list().length % PALETTE.length]

  /** The cached copy is the source of truth for account/calendar ownership of an event. */
  const cachedEvent = (ref: z.infer<typeof EventRef>): CalEvent => {
    account(ref.accountId)
    const ev = store.readCache(ref.accountId).events.find((e) => e.id === ref.id)
    if (!ev || ev.accountId !== ref.accountId || ev.calendarId !== ref.calendarId)
      throw new Error('event does not belong to this account/calendar')
    return ev
  }

  const writable = (ev: CalEvent): CalEvent => {
    const cal = store.readCache(ev.accountId).calendars.find((c) => c.id === ev.calendarId)
    if (!cal || cal.readOnly) throw new Error('calendar is read-only')
    return ev
  }

  const api: CoreApi = {
    accounts: {
      list: async () =>
        store.list().map((a) => ({ ...a, syncing: sync.isSyncing(a.id), synced: !!store.readCache(a.id).syncedAt })),
      addGoogle: async () => {
        const { email, credentials } = await deps.googleSignIn()
        const a = await store.add({ kind: 'google', label: email, email, color: nextColor() }, credentials)
        syncOne(a.id)
        deps.onAccountAdded?.({ provider: 'google' })
        return a
      },
      addCaldav: async (raw) => {
        const input = CaldavInput.parse(raw)
        const { email } = await deps.verifyCaldav(input)
        const { label, serverUrl, username, password } = input
        const a = await store.add(
          { kind: 'caldav', label, email, color: input.color ?? nextColor() },
          { kind: 'caldav', serverUrl, username, password }
        )
        syncOne(a.id)
        deps.onAccountAdded?.({ provider: 'caldav', preset: caldavPreset(serverUrl) })
        return a
      },
      update: async (accountId, patch) => {
        const a = await store.update(account(accountId).id, AccountPatch.parse(patch))
        deps.onChanged?.(a.id)
        return a
      },
      reauth: async (accountId, raw) => {
        const a = account(accountId)
        let credentials: Credentials
        if (a.kind === 'google') {
          const signed = await deps.googleSignIn()
          if (signed.email.toLowerCase() !== a.email.toLowerCase())
            throw new Error(`Signed in as ${signed.email}; sign in as ${a.email} to reconnect this account`)
          credentials = signed.credentials
        } else {
          const { password } = ReauthInput.parse(raw)
          const old = store.readCreds(a.id)
          if (old.kind !== 'caldav') throw new Error('Credentials kind does not match account kind')
          await deps.verifyCaldav({ label: a.label, serverUrl: old.serverUrl, username: old.username, password })
          credentials = { ...old, password }
        }
        const updated = await store.update(a.id, { credentials, error: undefined, authError: false })
        deps.onChanged?.(a.id)
        syncOne(a.id)
        return updated
      },
      remove: async (accountId) => {
        const a = account(accountId)
        await store.remove(a.id)
        deps.onChanged?.(a.id)
      }
    },
    calendars: {
      list: async () =>
        store.list().flatMap((a) => {
          const hidden = new Set(store.hiddenCalendars(a.id))
          return store.readCache(a.id).calendars.map((c) => ({ ...c, accountId: a.id, visible: !hidden.has(c.id) }))
        }),
      setVisible: async (accountId, calendarId, visible) => {
        const a = account(accountId)
        const cal = id.parse(calendarId)
        if (!store.readCache(a.id).calendars.some((c) => c.id === cal)) throw new Error('calendar does not belong to account')
        await store.setCalendarVisible(a.id, cal, z.boolean().parse(visible))
        deps.onChanged?.(a.id)
      }
    },
    events: {
      // `raw` stays in the daemon/main process: it can be huge (CalDAV series ICS) and writes re-read it from the cache.
      // Caches synced before `conferenceUrl` existed still hold the Meet link in the Google resource.
      list: async (raw) =>
        queryEvents(store, Range.parse(raw), false).map(({ raw: r, ...e }) =>
          e.conferenceUrl || !r || typeof r !== 'object' ? e : { ...e, conferenceUrl: conferenceUrlOf(r as GEvent) }
        ),
      create: async (raw) => {
        const input = NewEvent.parse(raw)
        const a = account(input.accountId)
        const cal = store.readCache(a.id).calendars.find((c) => c.id === input.calendarId)
        if (!cal) throw new Error('calendar does not belong to account')
        if (cal.readOnly) throw new Error('calendar is read-only')
        const ev = await store.getProvider(a.id).createEvent(cal.id, { ...input, accountId: a.id })
        upsert(ev, a.id, cal.id)
        syncOne(a.id)
        return ev
      },
      update: async (raw, scope) => {
        const edit = EventEdit.parse(raw)
        const cached = writable(cachedEvent(edit))
        const how = cached.recurringEventId ? Scope.parse(scope) : 'one'
        const { title, start, end, allDay, location, description, attendees, recurrence } = edit
        if (recurrence !== undefined && cached.recurringEventId && how === 'one')
          throw new Error('The repeat rule belongs to the series: choose “This and following” or “All events”')
        const ev = await store
          .getProvider(cached.accountId)
          .updateEvent({ ...cached, title, start, end, allDay, location, description, attendees, ...(recurrence !== undefined ? { recurrence } : {}) }, how)
        if (how === 'one') upsert(ev, cached.accountId, cached.calendarId)
        else {
          // The series' other instances moved or split; drop the stale ones until the sync below refills them.
          const own = { ...ev, accountId: cached.accountId, calendarId: cached.calendarId }
          applyLocal(cached.accountId, (events) => [...events.filter((e) => e.id !== own.id && !deletedBy(cached, how, e)), own])
        }
        syncOne(cached.accountId)
        return ev
      },
      delete: async (raw, scope) => {
        const cached = writable(cachedEvent(EventRef.parse(raw)))
        const how = Scope.parse(scope)
        await store.getProvider(cached.accountId).deleteEvent(cached, how)
        applyLocal(cached.accountId, (events) => events.filter((e) => !deletedBy(cached, how, e)))
        syncOne(cached.accountId)
      },
      recurrence: async (raw) => {
        const cached = cachedEvent(EventRef.parse(raw))
        return store.getProvider(cached.accountId).getRecurrence(cached)
      },
      respond: async (raw, status) => {
        const cached = cachedEvent(EventRef.parse(raw))
        const ev = await store.getProvider(cached.accountId).respond(cached, RsvpStatus.parse(status))
        upsert(ev, cached.accountId, cached.calendarId)
        syncOne(cached.accountId)
        return ev
      }
    },
    sync: {
      now: async (accountId) => {
        if (accountId === undefined || accountId === null) return sync.syncNow()
        return sync.syncNow(account(accountId).id)
      }
    }
  }
  return deps.onAction ? withActivityLog(api, store, deps.onAction) : api
}

/** Whether deleting `target` with `scope` removes `e` (a recurring series' other instances for 'all'/'following'). */
export function deletedBy(target: CalEvent, scope: z.infer<typeof Scope>, e: CalEvent): boolean {
  if (e.id === target.id) return true
  const series = target.recurringEventId
  if (!series || scope === 'one' || e.recurringEventId !== series || e.calendarId !== target.calendarId) return false
  return scope === 'all' || Date.parse(e.start) >= Date.parse(target.start)
}

/**
 * The same API, recording every change the user asks for (accounts, calendars, events) with its outcome. Reads the
 * cached event before the change, so the entry holds what it was; inputs are still validated by `api` itself.
 */
export function withActivityLog(api: CoreApi, store: ActivityStore, onAction: (e: LogEntry) => void): CoreApi {
  const field = (raw: unknown, k: string): string => {
    const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[k] : undefined
    return typeof v === 'string' ? v : ''
  }
  const cached = (raw: unknown): CalEvent | undefined => {
    try {
      return store.readCache(field(raw, 'accountId')).events.find((e) => e.id === field(raw, 'id') && e.calendarId === field(raw, 'calendarId'))
    } catch {
      return undefined
    }
  }
  const run = async <T>(kind: LogKind, accountId: string, entry: Partial<LogEntry>, fn: () => Promise<T>, after?: (r: T) => Partial<LogEntry>): Promise<T> => {
    const base = { at: new Date().toISOString(), accountId, email: store.get(accountId)?.email ?? '', kind, ...entry }
    try {
      const r = await fn()
      onAction({ ...base, ok: true, ...after?.(r) })
      return r
    } catch (e) {
      onAction({ ...base, ok: false, error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }
  const added = (a: { id: string; email: string; label: string }): Partial<LogEntry> => ({ accountId: a.id, email: a.email, detail: { label: a.label } })

  return {
    ...api,
    accounts: {
      ...api.accounts,
      addGoogle: () => run('account.add', '', { detail: { provider: 'google' } }, () => api.accounts.addGoogle(), added),
      addCaldav: (raw) => run('account.add', '', { email: field(raw, 'username'), detail: { provider: 'caldav' } }, () => api.accounts.addCaldav(raw), added),
      update: (accountId, patch) => {
        const a = store.get(String(accountId))
        const changes = (['label', 'color'] as const).flatMap((f) => {
          const to = field(patch, f)
          return a && to && to !== a[f] ? [{ field: f, from: a[f], to }] : []
        })
        return run('account.update', String(accountId), { changes }, () => api.accounts.update(accountId, patch))
      },
      reauth: (accountId, raw) => run('account.reauth', String(accountId), {}, () => api.accounts.reauth(accountId, raw)),
      remove: (accountId) =>
        run('account.remove', String(accountId), { detail: { label: store.get(String(accountId))?.label ?? '' } }, () => api.accounts.remove(accountId))
    },
    calendars: {
      ...api.calendars,
      setVisible: (accountId, calendarId, visible) => {
        let name = String(calendarId)
        try {
          name = store.readCache(String(accountId)).calendars.find((c) => c.id === calendarId)?.name ?? name
        } catch {
          // unknown account: api.calendars.setVisible refuses it
        }
        const detail = { calendar: name, visible: visible === true }
        return run('calendar.visible', String(accountId), { detail }, () => api.calendars.setVisible(accountId, calendarId, visible))
      }
    },
    events: {
      ...api.events,
      create: (raw) => run('event.create', field(raw, 'accountId'), {}, () => api.events.create(raw), (ev) => ({ event: snap(ev) })),
      update: (raw, scope) => {
        const old = cached(raw)
        const recurrence = raw && typeof raw === 'object' ? (raw as Partial<CalEvent>).recurrence : undefined
        return run(
          'event.update',
          field(raw, 'accountId'),
          { event: old && snap(old), scope: old?.recurringEventId ? (scope ?? 'one') : undefined },
          () => api.events.update(raw, scope),
          (ev) => ({ event: snap(ev), changes: old ? fieldChanges(old, { ...ev, recurrence }) : undefined })
        )
      },
      delete: (raw, scope) => {
        const old = cached(raw)
        return run('event.delete', field(raw, 'accountId'), { event: old && snap(old), scope: scope ?? 'one' }, () => api.events.delete(raw, scope))
      },
      respond: (raw, status) => {
        const old = cached(raw)
        return run(
          'event.respond',
          field(raw, 'accountId'),
          { event: old && snap(old), status: status as PartStat },
          () => api.events.respond(raw, status),
          (ev) => ({ event: snap(ev) })
        )
      }
    }
  }
}
