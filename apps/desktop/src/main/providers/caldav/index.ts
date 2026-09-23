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
import type { Calendar, CaldavAccountInput, CalEvent, TimeRange } from '@shared/types'
import type { CalendarProvider, ProviderFactory } from '../types'
import {
  applyDeleteFollowing,
  applyDeleteInstance,
  applyRespond,
  applyUpdate,
  buildIcs,
  cleanEmail,
  parseEvents,
  type CaldavRaw
} from './ics'

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
    const res = await fetch(input, init)
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
    if (unauthorized) throw new Error('CalDAV login failed: wrong username or password')
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
    projectedProps: { currentUserPrivilegeSet: true }
  })
  return cals.filter((c) => !c.components?.length || c.components.includes('VEVENT'))
}

function check(res: Response, what: string): void {
  if (res.ok) return
  if (res.status === 412) throw new Error(`${what} failed: the event was changed on the server, refresh and try again`)
  throw new Error(`${what} failed: ${res.status} ${res.statusText}`)
}

export const createCaldavProvider: ProviderFactory = (ctx) => {
  if (ctx.credentials.kind !== 'caldav') throw new Error('CalDAV provider needs caldav credentials')
  const { serverUrl, username, password } = ctx.credentials
  let conn: Promise<Conn> | undefined
  const getConn = (): Promise<Conn> => {
    conn ??= connect(serverUrl, username, password).catch((e) => {
      conn = undefined
      throw e
    })
    return conn
  }

  const mapCtx = (calendarId: string) => ({ accountId: ctx.accountId, calendarId, email: ctx.email })

  /** Re-read one object after a write to get fresh etag + server-normalized ICS. */
  async function reload(calendarId: string, href: string, id: string | undefined, around: TimeRange): Promise<CalEvent> {
    const { headers } = await getConn()
    const [obj] = await fetchCalendarObjects({ calendar: { url: calendarId }, objectUrls: [href], headers, urlFilter: () => true })
    if (!obj?.data) throw new Error('Saved event could not be read back from the server')
    const range = { start: new Date(new Date(around.start).getTime() - DAY).toISOString(), end: new Date(new Date(around.end).getTime() + DAY).toISOString() }
    const events = parseEvents(obj.data, id === undefined ? obj.url : href, obj.etag, mapCtx(calendarId), range)
    // A new object has one event; otherwise return exactly the edited instance.
    const ev = id === undefined ? events[0] : events.find((e) => e.id === id)
    if (!ev) throw new Error('Saved event not found on the server')
    return ev
  }

  const put = async (event: CalEvent, ics: string, what: string): Promise<void> => {
    const { headers } = await getConn()
    const raw = event.raw as CaldavRaw
    check(await updateCalendarObject({ calendarObject: { url: raw.href, data: ics, etag: event.etag }, headers }), what)
  }

  const provider: CalendarProvider = {
    async listCalendars() {
      const c = await getConn()
      return (await listVeventCalendars(c)).map((cal) => toCalendar(cal, ctx.accountId))
    },

    async listEvents(calendarId, range) {
      const { headers } = await getConn()
      const objs = await fetchCalendarObjects({ calendar: { url: calendarId }, timeRange: range, headers, urlFilter: () => true })
      return objs.flatMap((o) => (o.data ? parseEvents(o.data, o.url, o.etag, mapCtx(calendarId), range) : []))
    },

    async createEvent(calendarId, input) {
      const { headers } = await getConn()
      const uid = randomUUID()
      const filename = `${uid}.ics`
      const ics = buildIcs(uid, input, ctx.email)
      check(await createCalendarObject({ calendar: { url: calendarId }, filename, iCalString: ics, headers }), 'Create event')
      const href = new URL(filename, calendarId.endsWith('/') ? calendarId : `${calendarId}/`).href
      return reload(calendarId, href, undefined, input)
    },

    async updateEvent(event) {
      await put(event, applyUpdate(event, ctx.email), 'Update event')
      return reload(event.calendarId, (event.raw as CaldavRaw).href, event.id, event)
    },

    async deleteEvent(event, scope = 'one') {
      const raw = event.raw as CaldavRaw
      const rest = !raw.recurrenceId || scope === 'all' ? null : scope === 'following' ? applyDeleteFollowing(raw) : applyDeleteInstance(raw)
      if (rest) return put(event, rest, 'Delete event')
      const { headers } = await getConn()
      check(await deleteCalendarObject({ calendarObject: { url: raw.href, etag: event.etag }, headers }), 'Delete event')
    },

    async respond(event, status) {
      // The server performs RFC 6638 scheduling (iTIP REPLY to the organizer) on this PUT.
      await put(event, applyRespond(event.raw as CaldavRaw, ctx.email, status), 'Respond')
      return reload(event.calendarId, (event.raw as CaldavRaw).href, event.id, event)
    }
  }
  return provider
}

/** Validates credentials against the server and returns the account identity (email). */
export async function verifyCaldav(input: CaldavAccountInput): Promise<{ email: string }> {
  const c = await connect(input.serverUrl.trim(), input.username, input.password)
  await listVeventCalendars(c)
  // Prefer the server's calendar-user-address (what invites are sent to); the login name may differ.
  const addresses = await fetchCalendarUserAddresses({ account: c.account, headers: c.headers }).catch(() => [])
  const mails = addresses.filter((a) => /^mailto:/i.test(a)).map(cleanEmail)
  const login = cleanEmail(input.username)
  const email = mails.find((m) => m === login) ?? mails[0] ?? (login.includes('@') ? login : undefined)
  if (!email) throw new Error('Could not determine the account email; use your full email address as the username')
  return { email }
}
