import { randomUUID } from 'crypto'
import { Effect } from 'effect'
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
import { AppError, AuthError, HttpError, fail, messageOf, type ProviderError } from '../../errors'
import { fetchFor } from '../http'

const FALLBACK_COLOR = '#8e8e93'
const DAY = 864e5

interface Conn {
  account: DAVAccount
  headers: Record<string, string>
}

/** A tsdav call: its rejections become typed errors (a 401 already is an AuthError, see `davFetch`). */
const dav = <A>(what: (fetch: typeof globalThis.fetch) => Promise<A>): Effect.Effect<A, ProviderError> =>
  Effect.flatMap(davFetch, (fetch) =>
    Effect.tryPromise({
      try: () => what(fetch),
      catch: (e) => (e instanceof AuthError || e instanceof HttpError || (e as { _tag?: string })?._tag === 'TimeoutError' ? (e as ProviderError) : fail(messageOf(e)))
    })
  )

const connect = (serverUrl: string, username: string, password: string): Effect.Effect<Conn, ProviderError> =>
  Effect.gen(function* () {
    if (!URL.canParse(serverUrl)) return yield* fail(`Invalid server URL: ${serverUrl}`)
    const headers = getBasicAuthHeaders({ username, password })
    let unauthorized = false
    // Discovery treats a 401 as "no service here", so it is tracked instead of failed on.
    const trackingFetch = yield* fetchFor((res) => {
      if (res.status === 401) unauthorized = true
      return Effect.succeed(res)
    })
    const account = yield* Effect.tryPromise({
      try: () => createAccount({ account: { serverUrl, accountType: 'caldav', credentials: { username, password } }, headers, fetch: trackingFetch }),
      catch: (e) =>
        unauthorized
          ? new AuthError({ message: 'CalDAV login failed: wrong username or password' })
          : fail(`Could not find a CalDAV service at ${serverUrl}: ${messageOf(e)}`)
    })
    return { account, headers }
  })

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

const listVeventCalendars = (conn: Conn) =>
  dav((fetch) => fetchCalendars({ account: conn.account, headers: conn.headers, props: CALENDAR_PROPS, projectedProps: { currentUserPrivilegeSet: true }, fetch })).pipe(
    Effect.map((cals) => cals.filter((c) => !c.components?.length || c.components.includes('VEVENT')))
  )

/**
 * A fetch for tsdav that turns a 401 into an AuthError. tsdav reports a failed PROPFIND/REPORT as an empty result,
 * which would make a revoked password look like an account with no calendars.
 */
export const davFetch: Effect.Effect<typeof fetch> = fetchFor((res) =>
  res.status === 401 ? Effect.fail(new AuthError({ message: 'CalDAV login failed: the password was changed or revoked' })) : Effect.succeed(res)
)

const check = (res: Response, what: string): Effect.Effect<void, AppError> => {
  if (res.ok) return Effect.void
  if (res.status === 412) return Effect.fail(fail(`${what} failed: the event was changed on the server, refresh and try again`))
  return Effect.fail(fail(`${what} failed: ${res.status} ${res.statusText}`))
}

export const createCaldavProvider: ProviderFactory = (ctx) =>
  Effect.gen(function* () {
    if (ctx.credentials.kind !== 'caldav') return yield* fail('CalDAV provider needs caldav credentials')
    const { serverUrl, username, password } = ctx.credentials
    // Discovered once and reused; a failed discovery is retried on the next call.
    const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(connect(serverUrl, username, password), Infinity)
    const getConn = cached.pipe(Effect.tapError(() => invalidate))

    const mapCtx = (calendarId: string) => ({ accountId: ctx.accountId, calendarId, email: ctx.email })

    /**
     * Re-read one object after a write to get fresh etag + server-normalized ICS.
     * Returns the instance with `id`, else (a new or reshaped series) the one starting where `around` does.
     */
    const reload = (calendarId: string, href: string, id: string | undefined, around: TimeRange): Effect.Effect<CalEvent, ProviderError> =>
      Effect.gen(function* () {
        const { headers } = yield* getConn
        const [obj] = yield* dav((fetch) => fetchCalendarObjects({ calendar: { url: calendarId }, objectUrls: [href], headers, urlFilter: () => true, fetch }))
        if (!obj?.data) return yield* fail('Saved event could not be read back from the server')
        const range = { start: new Date(new Date(around.start).getTime() - DAY).toISOString(), end: new Date(new Date(around.end).getTime() + DAY).toISOString() }
        const events = parseEvents(obj.data, id === undefined ? obj.url : href, obj.etag, mapCtx(calendarId), range)
        const at = Date.parse(around.start)
        const ev = id === undefined ? (events.find((e) => Date.parse(e.start) === at) ?? events[0]) : events.find((e) => e.id === id)
        if (!ev) return yield* fail('Saved event not found on the server')
        return ev
      })

    const put = (event: CalEvent, ics: string, what: string): Effect.Effect<void, ProviderError> =>
      Effect.gen(function* () {
        const { headers } = yield* getConn
        const raw = event.raw as CaldavRaw
        yield* check(yield* dav((fetch) => updateCalendarObject({ calendarObject: { url: raw.href, data: ics, etag: event.etag }, headers, fetch })), what)
      })

    const create = (calendarId: string, filename: string, ics: string, what: string): Effect.Effect<string, ProviderError> =>
      Effect.gen(function* () {
        const { headers } = yield* getConn
        yield* check(yield* dav((fetch) => createCalendarObject({ calendar: { url: calendarId }, filename, iCalString: ics, headers, fetch })), what)
        return new URL(filename, calendarId.endsWith('/') ? calendarId : `${calendarId}/`).href
      })

    // Pure ICS transforms that refuse an edit become the user-facing error.
    const ics = <A>(f: () => A): Effect.Effect<A, AppError> => Effect.try({ try: f, catch: (e) => fail(messageOf(e)) })

    const provider: CalendarProvider = {
      listCalendars: () =>
        Effect.gen(function* () {
          const c = yield* getConn
          return (yield* listVeventCalendars(c)).map((cal) => toCalendar(cal, ctx.accountId))
        }),

      listEvents: (calendarId, range) =>
        Effect.gen(function* () {
          const { headers } = yield* getConn
          const objs = yield* dav((fetch) => fetchCalendarObjects({ calendar: { url: calendarId }, timeRange: range, headers, urlFilter: () => true, fetch }))
          return yield* ics(() => objs.flatMap((o) => (o.data ? parseEvents(o.data, o.url, o.etag, mapCtx(calendarId), range) : [])))
        }),

      createEvent: (calendarId, input) =>
        Effect.gen(function* () {
          const uid = randomUUID()
          const href = yield* create(calendarId, `${uid}.ics`, yield* ics(() => buildIcs(uid, input, ctx.email)), 'Create event')
          return yield* reload(calendarId, href, undefined, input)
        }),

      updateEvent: (event, scope = 'one') =>
        Effect.gen(function* () {
          const raw = event.raw as CaldavRaw
          if (!raw.recurrenceId || scope === 'one') {
            yield* put(event, yield* ics(() => applyUpdate(event, ctx.email)), 'Update event')
            // A single event that starts repeating gets instance ids: find it by time.
            return yield* reload(event.calendarId, raw.href, event.recurrence ? undefined : event.id, event)
          }
          const uid = randomUUID()
          const split = scope === 'following' ? yield* ics(() => applySplitFollowing(event, ctx.email, uid)) : null
          if (!split) {
            // "All events", or "this and following" from the first instance: the edited slot may move, so find it by time.
            yield* put(event, yield* ics(() => applyUpdateSeries(event, ctx.email)), 'Update event')
            return yield* reload(event.calendarId, raw.href, undefined, event)
          }
          // End the old series first: its etag guards against a concurrent change before anything new is written.
          yield* put(event, split.rest, 'Update event')
          const href = yield* create(event.calendarId, `${uid}.ics`, split.next, 'Update event')
          return yield* reload(event.calendarId, href, undefined, event)
        }),

      deleteEvent: (event, scope = 'one') =>
        Effect.gen(function* () {
          const raw = event.raw as CaldavRaw
          const rest = yield* ics(() =>
            !raw.recurrenceId || scope === 'all' ? null : scope === 'following' ? applyDeleteFollowing(raw) : applyDeleteInstance(raw)
          )
          if (rest) return yield* put(event, rest, 'Delete event')
          const { headers } = yield* getConn
          yield* check(yield* dav((fetch) => deleteCalendarObject({ calendarObject: { url: raw.href, etag: event.etag }, headers, fetch })), 'Delete event')
        }),

      getRecurrence: (event) => ics(() => recurrenceOf(event.raw as CaldavRaw)),

      respond: (event, status) =>
        Effect.gen(function* () {
          // The server performs RFC 6638 scheduling (iTIP REPLY to the organizer) on this PUT.
          yield* put(event, yield* ics(() => applyRespond(event.raw as CaldavRaw, ctx.email, status)), 'Respond')
          return yield* reload(event.calendarId, (event.raw as CaldavRaw).href, event.id, event)
        })
    }
    return provider
  })

/** Validates credentials against the server and returns the account identity (email). */
export const verifyCaldav = (input: CaldavAccountInput): Effect.Effect<{ email: string }, ProviderError> =>
  Effect.gen(function* () {
    const c = yield* connect(input.serverUrl.trim(), input.username, input.password)
    // Prefer the server's calendar-user-address (what invites are sent to); the login name may differ.
    const [, addresses] = yield* Effect.all(
      [listVeventCalendars(c), dav((fetch) => fetchCalendarUserAddresses({ account: c.account, headers: c.headers, fetch })).pipe(Effect.orElseSucceed(() => [] as string[]))],
      { concurrency: 2 }
    )
    const mails = addresses.filter((a) => /^mailto:/i.test(a)).map(cleanEmail)
    const login = cleanEmail(input.username)
    const email = mails.find((m) => m === login) ?? mails[0] ?? (login.includes('@') ? login : undefined)
    if (!email) return yield* fail('Could not determine the account email; use your full email address as the username')
    return { email }
  })
