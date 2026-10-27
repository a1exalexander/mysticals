import { randomUUID } from 'crypto'
import {
  createAccount,
  createCalendarObject,
  deleteCalendarObject,
  fetchCalendarObjects,
  fetchCalendars,
  fetchCalendarUserAddresses,
  getBasicAuthHeaders,
  updateCalendarObject,
  type DAVAccount
} from 'tsdav'
import type { Calendar, CaldavAccountInput, CalEvent, TimeRange } from '../../shared/types'
import type { CalendarProvider, ProviderFactory } from '../types'
import {
  applyColor,
  applyDeleteFollowing,
  applyDeleteInstance,
  applyRespond,
  applySplitFollowing,
  applyUpdate,
  applyUpdateSeries,
  buildIcs,
  cleanEmail,
  parseEvents,
  recurrenceOf,
  type CaldavRaw
} from './ics'
import { AuthError, timedFetch } from '../http'

const FALLBACK_COLOR = '#8e8e93'
const DAY = 864e5

interface Conn {
  account: DAVAccount
  headers: Record<string, string>
}

async function connect(serverUrl: string, username: string, password: string): Promise<Conn> {
  try {
    new URL(serverUrl)
  } catch {
    throw new Error(`Invalid server URL: ${serverUrl}`)
  }
  const headers = getBasicAuthHeaders({ username, password })
  let unauthorized = false
  const trackingFetch: typeof fetch = async (input, init) => {
    const res = await timedFetch(input, init)
    if (res.status === 401) unauthorized = true
    return res
  }
  try {
    const account = await createAccount({
      account: { serverUrl, accountType: 'caldav', credentials: { username, password } },
      headers,
      fetch: trackingFetch
    })
    return { account, headers }
  } catch (e) {
    if (unauthorized) throw new AuthError('CalDAV login failed: wrong username or password')
    throw new Error(`Could not find a CalDAV service at ${serverUrl}: ${(e as Error).message}`)
  }
}

export function toCalendar(c: Awaited<ReturnType<typeof fetchCalendars>>[number], accountId: string): Calendar {
  const name = typeof c.displayName === 'string' && c.displayName ? c.displayName : decodeURIComponent(c.url.split('/').filter(Boolean).pop() ?? c.url)
  const color = typeof c.calendarColor === 'string' && /^#[0-9a-f]{6}/i.test(c.calendarColor) ? c.calendarColor.slice(0, 7) : FALLBACK_COLOR
  const privileges = JSON.stringify(c.projectedProps?.currentUserPrivilegeSet ?? '')
  // No privilege info -> assume writable; otherwise require some form of write/all.
  const readOnly = privileges.includes('privilege') && !/"(write|writeContent|all)"/.test(privileges)
  return { id: c.url, accountId, name, color, readOnly }
}

const CALENDAR_PROPS = {
  'd:displayname': {},
  'ca:calendar-color': {},
  'cs:getctag': {},
  'd:resourcetype': {},
  'c:supported-calendar-component-set': {},
  'd:sync-token': {},
  'd:current-user-privilege-set': {}
}

async function listVeventCalendars(conn: Conn) {
  const cals = await fetchCalendars({
    account: conn.account,
    headers: conn.headers,
    props: CALENDAR_PROPS,
    projectedProps: { currentUserPrivilegeSet: true },
    fetch: davFetch
  })
  return cals.filter((c) => !c.components?.length || c.components.includes('VEVENT'))
}

/**
 * `timedFetch` that turns a 401 into an AuthError. tsdav reports a failed PROPFIND/REPORT as an empty result, which
 * would make a revoked password look like an account with no calendars.
 */
export const davFetch: typeof fetch = async (input, init) => {
  const res = await timedFetch(input, init)
  if (res.status === 401) throw new AuthError('CalDAV login failed: the password was changed or revoked')
  return res
}

function check(res: Response, what: string): void {
  if (res.ok) return
  if (res.status === 412) throw new Error(`${what} failed: the event was changed on the server, refresh and try again`)
  throw new Error(`${what} failed: ${res.status} ${res.statusText}`)
}

/** The principal's mailto: addresses (calendar-user-address-set), lowercased; undefined when the server won't say. */
async function addressesOf(conn: Conn): Promise<string[] | undefined> {
  const hrefs = await fetchCalendarUserAddresses({ account: conn.account, headers: conn.headers, fetch: davFetch }).catch(() => undefined)
  return hrefs && [...new Set(hrefs.filter((a) => /^mailto:/i.test(a)).map(cleanEmail).filter((m) => m.includes('@')))]
}

/** The addresses other than `email`: invites sent to them reach this account too. */
const aliasesOf = (addresses: string[], email: string): string[] => addresses.filter((m) => m !== cleanEmail(email))

export const createCaldavProvider: ProviderFactory = (ctx) => {
  if (ctx.credentials.kind !== 'caldav') throw new Error('CalDAV provider needs caldav credentials')
  const { serverUrl, username, password } = ctx.credentials
  // Accounts added before aliases were stored get them on the first connect.
  let aliases = ctx.aliases
  let conn: Promise<Conn> | undefined
  const getConn = (): Promise<Conn> => {
    conn ??= connect(serverUrl, username, password)
      .then(async (c) => {
        const found = aliases ? undefined : await addressesOf(c)
        if (found) {
          aliases = aliasesOf(found, ctx.email)
          ctx.saveAliases?.(aliases).catch((e) => console.error('saving CalDAV addresses failed', e))
        }
        return c
      })
      .catch((e) => {
        conn = undefined
        throw e
      })
    return conn
  }
  /** Every address of this account, for telling its own ATTENDEE apart. */
  const own = (): string[] => [ctx.email, ...(aliases ?? [])]

  // Read by listEvents: the engine calls listCalendars right before it every pass.
  let ctags = new Map<string, string | undefined>()
  const memo = new Map<string, { ctag: string; fetchedAt: number; events: CalEvent[] }>()
  let writes = 0

  const mapCtx = (calendarId: string) => ({ accountId: ctx.accountId, calendarId, email: ctx.email, aliases: aliases ?? [] })

  /**
   * Re-read one object after a write to get fresh etag + server-normalized ICS.
   * Returns the instance with `id`, else (a new or reshaped series) the one starting where `around` does.
   */
  async function reload(calendarId: string, href: string, id: string | undefined, around: TimeRange): Promise<CalEvent> {
    const { headers } = await getConn()
    const [obj] = await fetchCalendarObjects({ calendar: { url: calendarId }, objectUrls: [href], headers, urlFilter: () => true, fetch: davFetch })
    if (!obj?.data) throw new Error('Saved event could not be read back from the server')
    const range = { start: new Date(new Date(around.start).getTime() - DAY).toISOString(), end: new Date(new Date(around.end).getTime() + DAY).toISOString() }
    const events = parseEvents(obj.data, id === undefined ? obj.url : href, obj.etag, mapCtx(calendarId), range)
    const at = Date.parse(around.start)
    const ev = id === undefined ? (events.find((e) => Date.parse(e.start) === at) ?? events[0]) : events.find((e) => e.id === id)
    if (!ev) throw new Error('Saved event not found on the server')
    return ev
  }

  /** Every write goes through here: afterwards, drop the calendar's memo and void any listEvents still in flight. */
  const write = async (calendarId: string, req: Promise<Response>, what: string): Promise<void> => {
    try {
      check(await req, what)
    } finally {
      memo.delete(calendarId)
      writes++
    }
  }

  const put = async (event: CalEvent, ics: string, what: string): Promise<void> => {
    const { headers } = await getConn()
    const raw = event.raw as CaldavRaw
    await write(event.calendarId, updateCalendarObject({ calendarObject: { url: raw.href, data: ics, etag: event.etag }, headers, fetch: davFetch }), what)
  }

  const provider: CalendarProvider = {
    async listCalendars() {
      const c = await getConn()
      const cals = await listVeventCalendars(c)
      ctags = new Map(cals.map((cal) => [cal.url, cal.ctag]))
      for (const id of memo.keys()) if (!ctags.has(id)) memo.delete(id)
      return cals.map((cal) => toCalendar(cal, ctx.accountId))
    },

    async listEvents(calendarId, range) {
      const ctag = ctags.get(calendarId)
      const hit = memo.get(calendarId)
      // ponytail: an unchanged ctag reuses events fetched for an older range; window edges slide at most a day, the daily refetch keeps it moving. RFC 6578 sync-collection if that's not enough.
      if (ctag && hit?.ctag === ctag && Date.now() - hit.fetchedAt < DAY) return hit.events
      const { headers } = await getConn()
      const before = writes
      const objs = await fetchCalendarObjects({ calendar: { url: calendarId }, timeRange: range, headers, urlFilter: () => true, fetch: davFetch })
      const events = objs.flatMap((o) => (o.data ? parseEvents(o.data, o.url, o.etag, mapCtx(calendarId), range) : []))
      if (ctag && writes === before) memo.set(calendarId, { ctag, fetchedAt: Date.now(), events })
      else memo.delete(calendarId)
      return events
    },

    async createEvent(calendarId, input) {
      const { headers } = await getConn()
      const uid = randomUUID()
      const filename = `${uid}.ics`
      const ics = buildIcs(uid, input, ctx.email)
      await write(calendarId, createCalendarObject({ calendar: { url: calendarId }, filename, iCalString: ics, headers, fetch: davFetch }), 'Create event')
      const href = new URL(filename, calendarId.endsWith('/') ? calendarId : `${calendarId}/`).href
      return reload(calendarId, href, undefined, input)
    },

    async updateEvent(event, scope = 'one') {
      const raw = event.raw as CaldavRaw
      if (!raw.recurrenceId || scope === 'one') {
        await put(event, applyUpdate(event, ctx.email), 'Update event')
        // A single event that starts repeating gets instance ids: find it by time.
        return reload(event.calendarId, raw.href, event.recurrence ? undefined : event.id, event)
      }
      const uid = randomUUID()
      const split = scope === 'following' ? applySplitFollowing(event, ctx.email, uid) : null
      if (!split) {
        // "All events", or "this and following" from the first instance: the edited slot may move, so find it by time.
        await put(event, applyUpdateSeries(event, ctx.email), 'Update event')
        return reload(event.calendarId, raw.href, undefined, event)
      }
      // End the old series first: its etag guards against a concurrent change before anything new is written.
      await put(event, split.rest, 'Update event')
      const { headers } = await getConn()
      const filename = `${uid}.ics`
      await write(event.calendarId, createCalendarObject({ calendar: { url: event.calendarId }, filename, iCalString: split.next, headers, fetch: davFetch }), 'Update event')
      const href = new URL(filename, event.calendarId.endsWith('/') ? event.calendarId : `${event.calendarId}/`).href
      return reload(event.calendarId, href, undefined, event)
    },

    async deleteEvent(event, scope = 'one') {
      const raw = event.raw as CaldavRaw
      const rest = !raw.recurrenceId || scope === 'all' ? null : scope === 'following' ? applyDeleteFollowing(raw) : applyDeleteInstance(raw)
      if (rest) return put(event, rest, 'Delete event')
      const { headers } = await getConn()
      await write(event.calendarId, deleteCalendarObject({ calendarObject: { url: raw.href, etag: event.etag }, headers, fetch: davFetch }), 'Delete event')
    },

    async getRecurrence(event) {
      return recurrenceOf(event.raw as CaldavRaw)
    },

    async respond(event, status) {
      await getConn() // knows the account's addresses
      // The server performs RFC 6638 scheduling (iTIP REPLY to the organizer) on this PUT.
      await put(event, applyRespond(event.raw as CaldavRaw, own(), status), 'Respond')
      return reload(event.calendarId, (event.raw as CaldavRaw).href, event.id, event)
    },

    async setColor(event, colorId, scope) {
      await put(event, applyColor(event.raw as CaldavRaw, colorId, scope), 'Set colour')
      return reload(event.calendarId, (event.raw as CaldavRaw).href, event.id, event)
    }
  }
  return provider
}

/** Validates credentials against the server and returns the account identity (email) and its other addresses. */
export async function verifyCaldav(input: CaldavAccountInput): Promise<{ email: string; aliases: string[] }> {
  const c = await connect(input.serverUrl.trim(), input.username, input.password)
  await listVeventCalendars(c)
  // Prefer the server's calendar-user-address (what invites are sent to); the login name may differ.
  const mails = (await addressesOf(c)) ?? []
  const login = cleanEmail(input.username)
  const email = mails.find((m) => m === login) ?? mails[0] ?? (login.includes('@') ? login : undefined)
  if (!email) throw new Error('Could not determine the account email; use your full email address as the username')
  return { email, aliases: aliasesOf(mails, email) }
}
