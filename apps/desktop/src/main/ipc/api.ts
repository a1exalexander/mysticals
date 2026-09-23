import { z } from 'zod'
import type { Api } from '@shared/ipc'
import type { CaldavAccountInput, CalEvent, Credentials } from '@shared/types'
import type { AccountStore } from '../accounts/store'
import { queryEvents, type SyncEngine } from '../sync/engine'

export interface ApiDeps {
  verifyCaldav(input: CaldavAccountInput): Promise<{ email: string }>
  googleSignIn(): Promise<{ email: string; credentials: Extract<Credentials, { kind: 'google' }> }>
  /** Notify renderer that an account's data changed (visibility, label, removal). */
  onChanged?(accountId: string): void
}

const PALETTE = ['#bd93f9', '#50fa7b', '#8be9fd', '#ff79c6', '#ffb86c', '#f1fa8c']

// ---- Trust boundary: everything from the renderer is parsed here. ----
const id = z.string().min(1).max(1024)
const isoDateOrTime = z.union([z.iso.datetime({ offset: true }), z.iso.date()])
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const text = (max: number) => z.string().max(max)
const ordered = <T extends { start: string; end: string }>(v: T): boolean => Date.parse(v.end) >= Date.parse(v.start)

const Range = z.object({ start: isoDateOrTime, end: isoDateOrTime }).refine(ordered, 'end before start')

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
    attendees: z.array(z.email()).max(500).optional()
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
  attendees: z.array(Attendee).max(500)
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

const AccountPatch = z.object({ label: text(200).min(1).optional(), color: color.optional() }).strict()
const RsvpStatus = z.enum(['accepted', 'declined', 'tentative'])

export function createApi(store: AccountStore, sync: SyncEngine, deps: ApiDeps): Omit<Api, 'onChanged' | 'onMenu'> {
  const account = (accountId: unknown) => {
    const a = store.get(id.parse(accountId))
    if (!a) throw new Error('unknown account')
    return a
  }

  /** Fire-and-forget quiet sync of exactly one account after this app changed it (no notifications). */
  const syncOne = (accountId: string): void => {
    sync.syncNow(accountId, { quiet: true }).catch((e) => console.error(`sync ${accountId} failed`, e))
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

  return {
    accounts: {
      list: async () => store.list(),
      addGoogle: async () => {
        const { email, credentials } = await deps.googleSignIn()
        const a = await store.add({ kind: 'google', label: email, email, color: nextColor() }, credentials)
        syncOne(a.id)
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
        return a
      },
      update: async (accountId, patch) => {
        const a = await store.update(account(accountId).id, AccountPatch.parse(patch))
        deps.onChanged?.(a.id)
        return a
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
      list: async (raw) => queryEvents(store, Range.parse(raw), false),
      create: async (raw) => {
        const input = NewEvent.parse(raw)
        const a = account(input.accountId)
        const cal = store.readCache(a.id).calendars.find((c) => c.id === input.calendarId)
        if (!cal) throw new Error('calendar does not belong to account')
        if (cal.readOnly) throw new Error('calendar is read-only')
        const ev = await store.getProvider(a.id).createEvent(cal.id, { ...input, accountId: a.id })
        syncOne(a.id)
        return ev
      },
      update: async (raw) => {
        const edit = EventEdit.parse(raw)
        const cached = writable(cachedEvent(edit))
        const { title, start, end, allDay, location, description, attendees } = edit
        const ev = await store
          .getProvider(cached.accountId)
          .updateEvent({ ...cached, title, start, end, allDay, location, description, attendees })
        syncOne(cached.accountId)
        return ev
      },
      delete: async (raw) => {
        const cached = writable(cachedEvent(EventRef.parse(raw)))
        await store.getProvider(cached.accountId).deleteEvent(cached)
        syncOne(cached.accountId)
      },
      respond: async (raw, status) => {
        const cached = cachedEvent(EventRef.parse(raw))
        const ev = await store.getProvider(cached.accountId).respond(cached, RsvpStatus.parse(status))
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
}
