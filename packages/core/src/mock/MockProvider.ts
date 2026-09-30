import { randomUUID } from 'crypto'
import { addDays, differenceInCalendarDays, differenceInCalendarMonths, format, parseISO, startOfWeek } from 'date-fns'
import type { Calendar, CalEvent, DeleteScope, NewEventInput, PartStat, Recurrence, TimeRange } from '../shared/types'
import type { CalendarProvider } from '../providers/types'
import { weekdayOf } from '../logic/recurrence'

const MAX_INSTANCES = 60

/** The instances of `first`'s series under rule `r` (at most 60, within 3 years), each with its id and series. */
export function expand(first: CalEvent, r: Recurrence, series: string): CalEvent[] {
  const start = parseISO(first.start)
  const length = parseISO(first.end).getTime() - start.getTime()
  const every = r.interval ?? 1
  const days = r.byDay?.length ? r.byDay : [weekdayOf(first.start)]
  const until = r.until ? parseISO(r.until) : undefined
  const hits = (d: Date): boolean => {
    const n = differenceInCalendarDays(d, start)
    if (r.freq === 'daily') return n % every === 0
    if (r.freq === 'weekly')
      return days.includes(weekdayOf(format(d, 'yyyy-MM-dd'))) && differenceInCalendarDays(startOfWeek(d, { weekStartsOn: 1 }), startOfWeek(start, { weekStartsOn: 1 })) / 7 % every === 0
    const months = differenceInCalendarMonths(d, start)
    if (d.getDate() !== start.getDate()) return false
    return r.freq === 'monthly' ? months % every === 0 : months % (12 * every) === 0
  }
  const out: CalEvent[] = []
  for (let n = 0; n < 3 * 366 && out.length < (r.count ?? MAX_INSTANCES) && out.length < MAX_INSTANCES; n++) {
    const d = addDays(start, n)
    if (until && differenceInCalendarDays(d, until) > 0) break
    if (!hits(d)) continue
    const s = first.allDay ? format(d, 'yyyy-MM-dd') : d.toISOString()
    const e = first.allDay ? format(addDays(parseISO(first.end), n), 'yyyy-MM-dd') : new Date(d.getTime() + length).toISOString()
    out.push({ ...first, id: `${series}@${s}`, start: s, end: e, recurringEventId: series, recurrence: undefined })
  }
  return out
}

/** In-memory provider for tests and MYSTICALS_MOCK=1. One instance per fake account. */
export class MockProvider implements CalendarProvider {
  calendars: Calendar[]
  events: CalEvent[] = []
  /** Series id -> its rule. */
  rules = new Map<string, Recurrence>()

  constructor(
    readonly accountId: string,
    readonly email: string,
    calendars: Omit<Calendar, 'accountId'>[]
  ) {
    this.calendars = calendars.map((c) => ({ ...c, accountId }))
  }

  async listCalendars(): Promise<Calendar[]> {
    return structuredClone(this.calendars)
  }

  async listEvents(calendarId: string, range: TimeRange): Promise<CalEvent[]> {
    // Compare instants, not strings: parseISO reads date-only (all-day) values as local midnight, like queryEvents.
    const t = (iso: string): number => parseISO(iso).getTime()
    return structuredClone(
      this.events.filter((e) => e.calendarId === calendarId && t(e.end) > t(range.start) && t(e.start) < t(range.end))
    )
  }

  async createEvent(calendarId: string, input: NewEventInput): Promise<CalEvent> {
    const ev: CalEvent = {
      id: randomUUID(),
      accountId: this.accountId,
      calendarId,
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      location: input.location,
      description: input.description,
      organizer: { email: this.email },
      attendees: (input.attendees ?? []).map((email) => ({ email, status: 'needsAction' as const }))
    }
    if (input.recurrence) return this.startSeries(ev, input.recurrence, ev.id)
    this.events.push(ev)
    return structuredClone(ev)
  }

  /** Add the series `first` starts under `r` (or `first` alone for null); returns its first event. */
  private startSeries(first: CalEvent, r: Recurrence | null, series: string): CalEvent {
    const evs = r ? expand(first, r, series) : [{ ...first, recurringEventId: undefined, recurrence: undefined }]
    if (r) this.rules.set(series, r)
    this.events.push(...evs)
    return structuredClone(evs[0])
  }

  async getRecurrence(event: CalEvent): Promise<Recurrence | null> {
    return (event.recurringEventId && this.rules.get(event.recurringEventId)) || null
  }

  async updateEvent(event: CalEvent, scope: DeleteScope = 'one'): Promise<CalEvent> {
    const i = this.events.findIndex((e) => e.id === event.id)
    if (i < 0) throw new Error('not found')
    const old = this.events[i]
    const series = old.recurringEventId
    if (event.recurrence !== undefined && (!series || scope !== 'one')) {
      // New rule: "all" rebuilds the series from its first slot moved like this instance; "following" from here on.
      const own = (e: CalEvent): boolean => e.id === old.id || (!!series && e.recurringEventId === series && (scope === 'all' || e.start >= old.start))
      const firstOld = series && scope === 'all' ? this.events.filter(own).sort((a, b) => a.start.localeCompare(b.start))[0] : old
      this.events = this.events.filter((e) => !own(e))
      const shift = Date.parse(event.start) - Date.parse(old.start)
      const anchor = event.recurrence && firstOld !== old && !event.allDay
        ? { start: new Date(Date.parse(firstOld.start) + shift).toISOString(), end: new Date(Date.parse(firstOld.start) + shift + Date.parse(event.end) - Date.parse(event.start)).toISOString() }
        : {}
      const id = scope === 'all' && series ? series : randomUUID()
      return this.startSeries({ ...event, ...anchor, accountId: this.accountId }, event.recurrence, id)
    }
    if (series && scope !== 'one') {
      // Every selected instance takes the fields and the edited time offset and duration (timed series only).
      const shift = Date.parse(event.start) - Date.parse(old.start)
      const length = Date.parse(event.end) - Date.parse(event.start)
      const at = (ms: number): string => new Date(ms).toISOString()
      const { title, location, description, attendees } = event
      this.events = this.events.map((e) => {
        if (e.id === event.id || e.recurringEventId !== series || (scope === 'following' && e.start < old.start)) return e
        const moved = old.allDay || event.allDay ? {} : { start: at(Date.parse(e.start) + shift), end: at(Date.parse(e.start) + shift + length) }
        return { ...e, title, location, description, attendees, ...moved }
      })
    }
    this.events[i] = { ...event, accountId: this.accountId }
    return structuredClone(this.events[i])
  }

  async deleteEvent(event: CalEvent, scope: DeleteScope = 'one'): Promise<void> {
    const series = event.recurringEventId
    const hit = (e: CalEvent): boolean =>
      !series || scope === 'one'
        ? e.id === event.id
        : e.recurringEventId === series && (scope === 'all' || e.start >= event.start)
    this.events = this.events.filter((e) => !hit(e))
  }

  async respond(event: CalEvent, status: Exclude<PartStat, 'needsAction'>): Promise<CalEvent> {
    const ev = this.events.find((e) => e.id === event.id)
    if (!ev) throw new Error('not found')
    ev.myStatus = status
    ev.attendees = ev.attendees.map((a) => (a.self ? { ...a, status } : a))
    return structuredClone(ev)
  }
}
