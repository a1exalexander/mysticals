// Pure ICS parse/map/serialize logic for the CalDAV provider. No network here.
import ICAL from 'ical.js'
import type { Attendee, CalEvent, NewEventInput, PartStat, TimeRange } from '@shared/types'

/** Provider payload stored in CalEvent.raw. */
export interface CaldavRaw {
  href: string
  ics: string
  /** ical.js string of the instance's RECURRENCE-ID (recurring instances only). */
  recurrenceId?: string
}

export interface MapCtx {
  accountId: string
  calendarId: string
  /** The owning account's own identity. */
  email: string
}

const MAX_INSTANCES = 100_000

const PARTSTAT_IN: Record<string, PartStat> = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  'NEEDS-ACTION': 'needsAction'
}
const PARTSTAT_OUT: Record<PartStat, string> = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentative: 'TENTATIVE',
  needsAction: 'NEEDS-ACTION'
}

export const mapPartStat = (v: unknown): PartStat => PARTSTAT_IN[String(v ?? '').toUpperCase()] ?? 'needsAction'

export const cleanEmail = (v: unknown): string =>
  String(v ?? '')
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase()

const sameEmail = (a: unknown, b: unknown): boolean => cleanEmail(a) !== '' && cleanEmail(a) === cleanEmail(b)

function parse(ics: string): ICAL.Component {
  const root = new ICAL.Component(ICAL.parse(ics))
  // Register the object's own VTIMEZONEs so TZID times convert correctly.
  // ponytail: TZIDs without a VTIMEZONE are treated as floating (local) time; add an IANA tz table if servers omit them.
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const tz = new ICAL.Timezone(vtz)
    if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz)
  }
  return root
}

const toIso = (t: ICAL.Time): string => (t.isDate ? t.toString() : t.toJSDate().toISOString())

function fromIso(iso: string, allDay: boolean): ICAL.Time {
  if (allDay) return ICAL.Time.fromDateString(iso.slice(0, 10))
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`)
  return ICAL.Time.fromJSDate(d, true)
}

function setTime(vevent: ICAL.Component, name: 'dtstart' | 'dtend', t: ICAL.Time): void {
  vevent.removeAllProperties(name)
  vevent.addPropertyWithValue(name, t)
}

function setText(vevent: ICAL.Component, name: string, value: string | undefined): void {
  vevent.removeAllProperties(name)
  if (value) vevent.addPropertyWithValue(name, value)
}

function touch(vevent: ICAL.Component): void {
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now())
  vevent.updatePropertyWithValue('last-modified', ICAL.Time.now())
}

function mapPeople(vevent: ICAL.Component, email: string) {
  const orgProp = vevent.getFirstProperty('organizer')
  const organizer = orgProp
    ? { email: cleanEmail(orgProp.getFirstValue()), name: (orgProp.getParameter('cn') as string) || undefined }
    : undefined
  const attendees: Attendee[] = vevent.getAllProperties('attendee').map((p) => {
    const a: Attendee = { email: cleanEmail(p.getFirstValue()), status: mapPartStat(p.getParameter('partstat')) }
    const cn = p.getParameter('cn')
    if (cn) a.name = String(cn)
    if (sameEmail(a.email, email)) a.self = true
    if (organizer && sameEmail(a.email, organizer.email)) a.organizer = true
    return a
  })
  return { organizer, attendees, myStatus: attendees.find((a) => a.self)?.status }
}

/** Parse one calendar object into CalEvents, expanding recurrences inside `range`. */
export function parseEvents(ics: string, href: string, etag: string | undefined, ctx: MapCtx, range: TimeRange): CalEvent[] {
  const root = parse(ics)
  const vevents = root.getAllSubcomponents('vevent')
  const rangeStart = new Date(range.start).getTime()
  const rangeEnd = new Date(range.end).getTime()
  const inRange = (s: ICAL.Time, e: ICAL.Time): boolean => {
    const sm = s.toJSDate().getTime()
    const em = e.toJSDate().getTime()
    return sm < rangeEnd && (em > rangeStart || (em === sm && sm >= rangeStart))
  }

  const build = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrenceId?: ICAL.Time): CalEvent => {
    const rid = recurrenceId?.toString()
    const raw: CaldavRaw = { href, ics, ...(rid ? { recurrenceId: rid } : {}) }
    return {
      id: rid ? `${href}#${rid}` : href,
      accountId: ctx.accountId,
      calendarId: ctx.calendarId,
      title: item.summary ?? '',
      start: toIso(start),
      end: toIso(end),
      allDay: start.isDate,
      location: item.location || undefined,
      description: item.description || undefined,
      ...mapPeople(item.component, ctx.email),
      etag,
      raw,
      ...(rid ? { recurringEventId: href } : {})
    }
  }

  const master = vevents.find((v) => !v.hasProperty('recurrence-id'))
  if (!master) {
    // Orphan overrides (invited to single instances only): treat each as standalone.
    return vevents
      .map((v) => new ICAL.Event(v))
      .filter((e) => inRange(e.startDate, e.endDate))
      .map((e) => build(e, e.startDate, e.endDate, e.recurrenceId))
  }

  const event = new ICAL.Event(master)
  for (const v of vevents) if (v !== master) event.relateException(v)
  if (!event.isRecurring()) return inRange(event.startDate, event.endDate) ? [build(event, event.startDate, event.endDate)] : []

  const out: CalEvent[] = []
  const it = event.iterator()
  // An override can move an instance into the range from a later slot: iterate past the last overridden slot too.
  const lastOverride = Math.max(
    -Infinity,
    ...vevents.filter((v) => v !== master).map((v) => (v.getFirstPropertyValue('recurrence-id') as ICAL.Time).toJSDate().getTime())
  )
  for (let i = 0, next = it.next(); next && i < MAX_INSTANCES; i++, next = it.next()) {
    const ms = next.toJSDate().getTime()
    if (ms >= rangeEnd && ms > lastOverride) break
    const d = event.getOccurrenceDetails(next)
    if (inRange(d.startDate, d.endDate)) out.push(build(d.item, d.startDate, d.endDate, d.recurrenceId))
  }
  return out
}

/** Build a new single-VEVENT calendar object. ORGANIZER only when there are attendees. */
export function buildIcs(uid: string, input: NewEventInput, email: string): string {
  const root = new ICAL.Component(['vcalendar', [], []])
  root.addPropertyWithValue('prodid', '-//Multicals//EN')
  root.addPropertyWithValue('version', '2.0')
  const v = new ICAL.Component('vevent')
  v.addPropertyWithValue('uid', uid)
  v.addPropertyWithValue('dtstamp', ICAL.Time.now())
  v.addPropertyWithValue('created', ICAL.Time.now())
  v.addPropertyWithValue('sequence', 0)
  setTime(v, 'dtstart', fromIso(input.start, input.allDay))
  setTime(v, 'dtend', fromIso(input.end, input.allDay))
  setText(v, 'summary', input.title)
  setText(v, 'location', input.location)
  setText(v, 'description', input.description)
  setAttendees(v, input.attendees ?? [], email)
  root.addSubcomponent(v)
  return root.toString()
}

/**
 * Sync ATTENDEEs to exactly `emails` (only what the user listed), keeping existing params
 * for kept attendees. Adds ORGANIZER = own identity only if attendees exist and none is set.
 */
function setAttendees(v: ICAL.Component, emails: string[], email: string): void {
  const wanted = [...new Set(emails.map(cleanEmail).filter(Boolean))]
  const existing = new Map(v.getAllProperties('attendee').map((p) => [cleanEmail(p.getFirstValue()), p]))
  v.removeAllProperties('attendee')
  for (const e of wanted) {
    let p = existing.get(e)
    if (!p) {
      p = new ICAL.Property('attendee')
      p.setValue(`mailto:${e}`)
      p.setParameter('partstat', 'NEEDS-ACTION')
      p.setParameter('rsvp', 'TRUE')
    }
    v.addProperty(p)
  }
  if (wanted.length && !v.hasProperty('organizer')) v.addPropertyWithValue('organizer', `mailto:${cleanEmail(email)}`)
}

const findMaster = (root: ICAL.Component) => root.getAllSubcomponents('vevent').find((v) => !v.hasProperty('recurrence-id'))

function masterOf(root: ICAL.Component): ICAL.Component {
  const m = findMaster(root)
  if (!m) throw new Error('Calendar object has no master VEVENT')
  return m
}

/** The stored RECURRENCE-ID string as a Time in the master's DTSTART zone. */
function ridTime(master: ICAL.Component, rid: string): { time: ICAL.Time; tzid?: string } {
  const time = rid.length === 10 ? ICAL.Time.fromDateString(rid) : ICAL.Time.fromDateTimeString(rid)
  const tzid = rid.endsWith('Z') ? undefined : (master.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined)
  const zone = tzid ? ICAL.TimezoneService.get(tzid) : undefined
  if (zone) time.zone = zone
  return { time, tzid }
}

/** Find the override for `rid`, matching by instant so a UTC RECURRENCE-ID matches a TZID one. */
function findOverride(root: ICAL.Component, rid: string): ICAL.Component | undefined {
  const master = findMaster(root)
  const want = master ? ridTime(master, rid).time.toJSDate().getTime() : NaN
  return root.getAllSubcomponents('vevent').find((v) => {
    const t = v.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
    return !!t && (String(t) === rid || t.toJSDate().getTime() === want)
  })
}

/** Build a RECURRENCE-ID/EXDATE property for `rid` using the master's DTSTART type and TZID. */
function ridProp(master: ICAL.Component, name: 'recurrence-id' | 'exdate', rid: string): ICAL.Property {
  const { time, tzid } = ridTime(master, rid)
  const p = new ICAL.Property(name)
  p.setValue(time)
  if (tzid) p.setParameter('tzid', tzid)
  return p
}

/** Return the VEVENT to edit for `raw`: master, existing override, or a new override for the instance. */
function targetVevent(root: ICAL.Component, raw: CaldavRaw): ICAL.Component {
  if (!raw.recurrenceId) return masterOf(root)
  const existing = findOverride(root, raw.recurrenceId)
  if (existing) return existing
  // ponytail: edits apply to this single instance only (new override); series-wide edits are not supported yet.
  const master = masterOf(root)
  const o = new ICAL.Component(structuredClone(master.toJSON()))
  for (const n of ['rrule', 'rdate', 'exdate', 'exrule']) o.removeAllProperties(n)
  o.addProperty(ridProp(master, 'recurrence-id', raw.recurrenceId))
  root.addSubcomponent(o)
  return o
}

/** Apply an edited CalEvent onto its original ICS, keeping every other component/prop. */
export function applyUpdate(event: CalEvent, email: string): string {
  const raw = event.raw as CaldavRaw
  const root = parse(raw.ics)
  const v = targetVevent(root, raw)
  setTime(v, 'dtstart', fromIso(event.start, event.allDay))
  v.removeAllProperties('duration')
  setTime(v, 'dtend', fromIso(event.end, event.allDay))
  setText(v, 'summary', event.title)
  setText(v, 'location', event.location)
  setText(v, 'description', event.description)
  setAttendees(
    v,
    event.attendees.map((a) => a.email),
    email
  )
  v.updatePropertyWithValue('sequence', Number(v.getFirstPropertyValue('sequence') ?? 0) + 1)
  touch(v)
  return root.toString()
}

/**
 * Remove one instance of a recurring series: EXDATE on the master, drop its override.
 * Returns null when nothing would remain (a lone orphan override): delete the whole object instead.
 */
export function applyDeleteInstance(raw: CaldavRaw): string | null {
  if (!raw.recurrenceId) throw new Error('Not a recurring instance')
  const root = parse(raw.ics)
  const override = findOverride(root, raw.recurrenceId)
  if (override) root.removeSubcomponent(override)
  const master = findMaster(root)
  if (!master) return root.getAllSubcomponents('vevent').length ? root.toString() : null
  master.addProperty(ridProp(master, 'exdate', raw.recurrenceId))
  master.updatePropertyWithValue('sequence', Number(master.getFirstPropertyValue('sequence') ?? 0) + 1)
  touch(master)
  return root.toString()
}

/**
 * End a recurring series right before this instance: RRULE UNTIL one tick earlier (COUNT dropped),
 * overrides at or after the instance removed. Returns null when nothing would remain (cut at or before
 * the first instance, or no master): delete the whole object instead.
 */
export function applyDeleteFollowing(raw: CaldavRaw): string | null {
  if (!raw.recurrenceId) throw new Error('Not a recurring instance')
  const root = parse(raw.ics)
  const master = findMaster(root)
  if (!master) return null
  const { time } = ridTime(master, raw.recurrenceId)
  const cut = time.toJSDate().getTime()
  if (cut <= (master.getFirstPropertyValue('dtstart') as ICAL.Time).toJSDate().getTime()) return null
  for (const v of root.getAllSubcomponents('vevent')) {
    const t = v.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
    if (t && t.toJSDate().getTime() >= cut) root.removeSubcomponent(v)
  }
  // RFC 5545: UNTIL is a DATE for all-day series, UTC for zoned ones, local for floating ones.
  let until = time.clone()
  if (until.isDate) until.adjust(-1, 0, 0, 0)
  else {
    until.adjust(0, 0, 0, -1)
    if (until.zone !== ICAL.Timezone.localTimezone) until = until.convertToZone(ICAL.Timezone.utcTimezone)
  }
  for (const p of master.getAllProperties('rrule')) {
    const r = (p.getFirstValue() as ICAL.Recur).clone()
    r.count = null
    r.until = until
    p.setValue(r)
  }
  master.updatePropertyWithValue('sequence', Number(master.getFirstPropertyValue('sequence') ?? 0) + 1)
  touch(master)
  return root.toString()
}

/**
 * Set ONLY the own ATTENDEE's PARTSTAT (matched by `email`) on every VEVENT of the object.
 * Never touches ORGANIZER or other attendees. Throws if the account is not invited.
 * ponytail: responds to the whole series; per-instance RSVP needs an override like applyUpdate.
 */
export function applyRespond(raw: CaldavRaw, email: string, status: Exclude<PartStat, 'needsAction'>): string {
  const root = parse(raw.ics)
  let found = false
  for (const v of root.getAllSubcomponents('vevent')) {
    for (const p of v.getAllProperties('attendee')) {
      if (!sameEmail(p.getFirstValue(), email)) continue
      p.setParameter('partstat', PARTSTAT_OUT[status])
      p.removeParameter('rsvp')
      p.removeParameter('schedule-status')
      found = true
    }
    if (found) v.updatePropertyWithValue('dtstamp', ICAL.Time.now())
  }
  if (!found) throw new Error('This account is not an attendee of the event')
  return root.toString()
}
