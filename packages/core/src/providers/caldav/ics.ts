// Pure ICS parse/map/serialize logic for the CalDAV provider. No network here.
import ICAL from 'ical.js'
import type { Attendee, CalEvent, NewEventInput, PartStat, Recurrence, TimeRange } from '../../shared/types'
import { fromRRule, toRRule } from '../../logic/recurrence'

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

/** Video call of an event: RFC 7986 CONFERENCE (first http(s) one) or Google's X-GOOGLE-CONFERENCE. */
function conferenceOf(vevent: ICAL.Component): string | undefined {
  const urls = [...vevent.getAllProperties('conference'), ...vevent.getAllProperties('x-google-conference')].map((p) => String(p.getFirstValue() ?? '').trim())
  return urls.find((u) => /^https?:\/\//i.test(u))
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
    const conference = conferenceOf(item.component)
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
      ...(conference ? { conferenceUrl: conference } : {}),
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
  root.addPropertyWithValue('prodid', '-//Mysticals//EN')
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
  if (input.recurrence) setRule(v, input.recurrence, input.allDay)
  root.addSubcomponent(v)
  return root.toString()
}

function setRule(v: ICAL.Component, r: Recurrence, allDay: boolean): void {
  v.removeAllProperties('rrule')
  v.addPropertyWithValue('rrule', ICAL.Recur.fromString(toRRule(r, allDay)))
}

/** The series rule of a CalDAV event (from its stored ICS), null for a single event. */
export function recurrenceOf(raw: CaldavRaw): Recurrence | null {
  const master = findMaster(parse(raw.ics))
  const rule = master?.getFirstPropertyValue('rrule') as ICAL.Recur | null | undefined
  return master && rule ? fromRRule(rule.toString(), toIso(dtstart(master))) : null
}

/**
 * Give the series `event.recurrence` (after its fields were rewritten): a new RRULE, dropping the
 * EXDATEs and overrides it no longer has a slot for; or, for null, just the edited event on its own.
 */
function applyRule(root: ICAL.Component, master: ICAL.Component, event: CalEvent): void {
  if (event.recurrence === undefined) return
  const overrides = root.getAllSubcomponents('vevent').filter((v) => v !== master)
  if (event.recurrence === null) {
    for (const n of ['rrule', 'rdate', 'exdate']) master.removeAllProperties(n)
    for (const o of overrides) root.removeSubcomponent(o)
    master.addProperty(replaceTime(master, 'dtstart', fromIso(event.start, event.allDay)))
    master.addProperty(replaceTime(master, 'dtend', fromIso(event.end, event.allDay)))
    return
  }
  setRule(master, event.recurrence, event.allDay)
  const ms = (t: ICAL.Time): number => t.toJSDate().getTime()
  const rid = (o: ICAL.Component): ICAL.Time => o.getFirstPropertyValue('recurrence-id') as ICAL.Time
  const exdates = master.getAllProperties('exdate').flatMap((p) => p.getValues()).filter((t): t is ICAL.Time => t instanceof ICAL.Time)
  const last = Math.max(-Infinity, ...overrides.map((o) => ms(rid(o))), ...exdates.map(ms))
  const slots = new Set<number>()
  const it = (master.getFirstPropertyValue('rrule') as ICAL.Recur).iterator(dtstart(master))
  for (let t = it.next(), n = 0; t && ms(t) <= last && n < MAX_INSTANCES; t = it.next(), n++) slots.add(ms(t))
  for (const o of overrides) if (!slots.has(ms(rid(o)))) root.removeSubcomponent(o)
  mapDates(master, 'exdate', (t) => (slots.has(ms(t)) ? t : null))
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
  writeEdit(v, event, email, fromIso(event.start, event.allDay), fromIso(event.end, event.allDay))
  // A single event can start repeating here; a series' rule changes via applyUpdateSeries / applySplitFollowing.
  if (event.recurrence && !raw.recurrenceId && !v.hasProperty('rrule')) setRule(v, event.recurrence, event.allDay)
  return root.toString()
}

/** Write the edited fields of `event` onto one VEVENT, with the given DTSTART/DTEND. */
function writeEdit(v: ICAL.Component, event: CalEvent, email: string, start: ICAL.Time, end: ICAL.Time): void {
  v.addProperty(replaceTime(v, 'dtstart', start))
  v.removeAllProperties('duration')
  v.addProperty(replaceTime(v, 'dtend', end))
  setText(v, 'summary', event.title)
  setText(v, 'location', event.location)
  setText(v, 'description', event.description)
  setAttendees(
    v,
    event.attendees.map((a) => a.email),
    email
  )
  bump(v)
}

function bump(v: ICAL.Component): void {
  v.updatePropertyWithValue('sequence', Number(v.getFirstPropertyValue('sequence') ?? 0) + 1)
  touch(v)
}

/** A DATE-TIME/DATE property for `t`, with TZID when `t` is in a named zone (not UTC or floating). */
function timeProp(name: string, t: ICAL.Time): ICAL.Property {
  const p = new ICAL.Property(name)
  p.setValue(t)
  const tzid = t.zone?.tzid
  if (!t.isDate && tzid && tzid !== 'UTC' && tzid !== 'floating') p.setParameter('tzid', tzid)
  return p
}

/** Drop every `name` property of `v` and return a fresh one for `t` (the caller adds it). */
function replaceTime(v: ICAL.Component, name: string, t: ICAL.Time): ICAL.Property {
  v.removeAllProperties(name)
  return timeProp(name, t)
}

const dtstart = (v: ICAL.Component): ICAL.Time => v.getFirstPropertyValue('dtstart') as ICAL.Time
const dateOf = (t: ICAL.Time): ICAL.Time => ICAL.Time.fromData({ year: t.year, month: t.month, day: t.day, isDate: true })
const daysBetween = (a: ICAL.Time, b: ICAL.Time): number => Math.round(dateOf(b).subtractDate(dateOf(a)).toSeconds() / 86_400)
function addDays(t: ICAL.Time, days: number): ICAL.Time {
  const x = t.clone()
  x.adjust(days, 0, 0, 0)
  return x
}

/** DTSTART/DTEND for an occurrence starting at `start` with the edited event's duration. */
function spanFrom(start: ICAL.Time, event: CalEvent): [ICAL.Time, ICAL.Time] {
  if (event.allDay) return [start, addDays(start, daysBetween(fromIso(event.start, true), fromIso(event.end, true)))]
  const end = start.clone()
  end.adjust(0, 0, 0, (Date.parse(event.end) - Date.parse(event.start)) / 1000)
  return [start, end]
}

/**
 * How editing one instance (which started at `before`) moves every other slot of the series: by the same
 * wall-clock offset in the series' zone, so "9:00 → 10:00" stays 10:00 across DST. Switching all-day on or
 * off keeps each slot's day offset and takes the edited time of day.
 */
function slotShift(master: ICAL.Component, before: ICAL.Time, event: CalEvent): (t: ICAL.Time) => ICAL.Time {
  const anchor = dtstart(master)
  const zone = anchor.isDate ? undefined : anchor.zone
  const local = (t: ICAL.Time): ICAL.Time => (zone && !t.isDate ? t.convertToZone(zone) : t.clone())
  const after = fromIso(event.start, event.allDay)
  if (event.allDay) {
    const days = daysBetween(local(before), after)
    return (t) => addDays(dateOf(local(t)), days)
  }
  if (!anchor.isDate) {
    const seconds = (zone ? after.convertToZone(zone) : after).subtractDate(local(before)).toSeconds()
    return (t) => {
      const x = local(t)
      x.adjust(0, 0, 0, seconds)
      return x
    }
  }
  // All-day series becomes timed: `after` is UTC, so the new slots are too.
  const days = daysBetween(before, after)
  return (t) => {
    const d = addDays(dateOf(t), days)
    return ICAL.Time.fromData({ year: d.year, month: d.month, day: d.day, hour: after.hour, minute: after.minute, second: after.second }, ICAL.Timezone.utcTimezone)
  }
}

/** Replace every value of the multi-valued `name` (EXDATE/RDATE) by `map(value)`; null drops it. PERIOD values are kept. */
function mapDates(v: ICAL.Component, name: 'exdate' | 'rdate', map: (t: ICAL.Time) => ICAL.Time | null): void {
  const props = v.getAllProperties(name)
  if (!props.length) return
  const out: ICAL.Property[] = []
  for (const p of props) {
    for (const value of p.getValues()) {
      if (!(value instanceof ICAL.Time)) {
        const keep = new ICAL.Property(name)
        keep.setValue(value as ICAL.Period)
        out.push(keep)
        continue
      }
      const t = map(value)
      if (t) out.push(timeProp(name, t))
    }
  }
  v.removeAllProperties(name)
  for (const p of out) v.addProperty(p)
}

const attendeeKey = (v: ICAL.Component): string =>
  v.getAllProperties('attendee').map((p) => cleanEmail(p.getFirstValue())).sort().join(',')

/**
 * Apply the edit of one instance to a whole series: the master takes the edited fields and its slots
 * shift like the edited instance did (EXDATE/RDATE/RECURRENCE-ID follow, so overrides keep matching).
 * The edited instance's own override takes the edit as-is; other overrides keep their customised fields
 * but take the ones they shared with the old master.
 */
function rewriteSeries(
  root: ICAL.Component,
  master: ICAL.Component,
  edited: ICAL.Component | undefined,
  event: CalEvent,
  email: string,
  shift: (t: ICAL.Time) => ICAL.Time,
  anchor: ICAL.Time
): void {
  const shared = ['summary', 'location', 'description'].map((n) => [n, master.getFirstPropertyValue(n)] as const)
  const people = attendeeKey(master)
  const retyped = dtstart(master).isDate !== event.allDay
  const [start, end] = spanFrom(shift(anchor), event)
  writeEdit(master, event, email, start, end)
  mapDates(master, 'exdate', shift)
  mapDates(master, 'rdate', shift)
  for (const o of root.getAllSubcomponents('vevent')) {
    const rid = o.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
    if (!rid) continue
    o.addProperty(replaceTime(o, 'recurrence-id', shift(rid)))
    if (o === edited) {
      writeEdit(o, event, email, fromIso(event.start, event.allDay), fromIso(event.end, event.allDay))
      continue
    }
    const [s, e] = retyped ? spanFrom(shift(dtstart(o)), event) : [shift(dtstart(o)), shift(new ICAL.Event(o).endDate)]
    o.addProperty(replaceTime(o, 'dtstart', s))
    o.removeAllProperties('duration')
    o.addProperty(replaceTime(o, 'dtend', e))
    for (const [name, old] of shared) {
      if (String(o.getFirstPropertyValue(name) ?? '') === String(old ?? '')) setText(o, name, event[name === 'summary' ? 'title' : (name as 'location' | 'description')])
    }
    if (attendeeKey(o) === people) setAttendees(o, event.attendees.map((a) => a.email), email)
    bump(o)
  }
}

/** The instance's own DTSTART before the edit: its override's if it has one, else its series slot. */
const instanceStart = (master: ICAL.Component, override: ICAL.Component | undefined, rid: string): ICAL.Time =>
  override ? dtstart(override) : ridTime(master, rid).time

/**
 * Apply the edit of one recurring instance to its whole series ("All events").
 * A non-recurring event, or an object without a master, gets a plain single edit.
 */
export function applyUpdateSeries(event: CalEvent, email: string): string {
  const raw = event.raw as CaldavRaw
  const root = parse(raw.ics)
  const master = findMaster(root)
  if (!raw.recurrenceId || !master) return applyUpdate(event, email)
  const edited = findOverride(root, raw.recurrenceId)
  const shift = slotShift(master, instanceStart(master, edited, raw.recurrenceId), event)
  rewriteSeries(root, master, edited, event, email, shift, dtstart(master))
  applyRule(root, master, event)
  return root.toString()
}

/**
 * Apply the edit of one recurring instance to it and every later one ("This and following"):
 * `rest` is the old object ended right before the instance, `next` a new series (new `uid`) from the
 * instance on, carrying the later overrides/exceptions. COUNT is split between both.
 * Returns null when the instance is the series' first: edit the whole series instead.
 */
export function applySplitFollowing(event: CalEvent, email: string, uid: string): { rest: string; next: string } | null {
  const raw = event.raw as CaldavRaw
  if (!raw.recurrenceId) throw new Error('Not a recurring instance')
  const rest = applyDeleteFollowing(raw)
  if (!rest) return null
  const root = parse(raw.ics)
  const master = masterOf(root)
  const slot = ridTime(master, raw.recurrenceId).time
  const cut = slot.toJSDate().getTime()
  const edited = findOverride(root, raw.recurrenceId)
  const shift = slotShift(master, instanceStart(master, edited, raw.recurrenceId), event)
  for (const v of root.getAllSubcomponents('vevent')) {
    const t = v.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
    if (t && t.toJSDate().getTime() < cut) root.removeSubcomponent(v)
  }
  const later = (t: ICAL.Time): ICAL.Time | null => (t.toJSDate().getTime() >= cut ? t : null)
  mapDates(master, 'exdate', later)
  mapDates(master, 'rdate', later)
  // COUNT counts RRULE slots (EXDATEs included), so the new series gets what the old one had left.
  // A new rule (applyRule below) starts counting afresh.
  const first = dtstart(master)
  for (const p of event.recurrence === undefined ? master.getAllProperties('rrule') : []) {
    const r = (p.getFirstValue() as ICAL.Recur).clone()
    if (!r.count) continue
    const it = r.iterator(first)
    let passed = 0
    for (let t = it.next(); t && t.toJSDate().getTime() < cut && passed < MAX_INSTANCES; t = it.next()) passed++
    r.count = Math.max(1, r.count - passed)
    p.setValue(r)
  }
  for (const v of root.getAllSubcomponents('vevent')) {
    v.updatePropertyWithValue('uid', uid)
    v.updatePropertyWithValue('sequence', -1) // rewriteSeries bumps every VEVENT to 0
    v.updatePropertyWithValue('created', ICAL.Time.now())
  }
  rewriteSeries(root, master, edited, event, email, shift, slot)
  applyRule(root, master, event)
  return { rest, next: root.toString() }
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
