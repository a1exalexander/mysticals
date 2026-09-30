// Repeat rules: RRULE <-> Recurrence, presets and text for the editors. Pure; no provider code here.
import { format, isValid, parseISO } from 'date-fns'
import type { Recurrence, Weekday } from '../shared/types'

export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const JS_DAY: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const SHORT: Record<Weekday, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }
const WORKWEEK: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR']
export const FREQS: Recurrence['freq'][] = ['daily', 'weekly', 'monthly', 'yearly']
const UNIT: Record<Recurrence['freq'], string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }

/** A form start ('YYYY-MM-DDTHH:mm' local), a 'YYYY-MM-DD' date or an ISO instant, as a local Date. */
const asDate = (start: string): Date => (start.length === 10 ? parseISO(start) : new Date(start))
export const weekdayOf = (start: string): Weekday => JS_DAY[asDate(start).getDay()]
export const shortDay = (d: Weekday): string => SHORT[d]

/**
 * The canonical form of `r` for an event starting at `start`: defaults dropped, days sorted, the
 * start's own weekday left implicit, UNTIL winning over COUNT. Custom rules pass through.
 */
export function normalize(r: Recurrence, start: string): Recurrence {
  if (r.rule) return { freq: r.freq, rule: r.rule }
  const out: Recurrence = { freq: r.freq }
  if (r.interval && r.interval > 1) out.interval = r.interval
  if (r.freq === 'weekly' && r.byDay?.length) {
    const days = WEEKDAYS.filter((d) => r.byDay!.includes(d))
    if (!(days.length === 1 && days[0] === weekdayOf(start))) out.byDay = days
  }
  if (r.until) out.until = r.until
  else if (r.count) out.count = r.count
  return out
}

/** Whether two rules repeat the same way. null = does not repeat; undefined = not known yet. */
export function sameRecurrence(a: Recurrence | null | undefined, b: Recurrence | null | undefined, start: string): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(normalize(a, start)) === JSON.stringify(normalize(b, start))
}

/** RRULE value (without "RRULE:"). UNTIL is a DATE for all-day events, else the end of that local day in UTC. */
export function toRRule(r: Recurrence, allDay: boolean): string {
  if (r.rule) return r.rule
  const parts = [`FREQ=${r.freq.toUpperCase()}`]
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`)
  if (r.freq === 'weekly' && r.byDay?.length) parts.push(`BYDAY=${WEEKDAYS.filter((d) => r.byDay!.includes(d)).join(',')}`)
  if (r.until) {
    const until = allDay ? r.until.replace(/-/g, '') : new Date(`${r.until}T23:59:59`).toISOString().replace(/[-:]|\.\d{3}/g, '')
    parts.push(`UNTIL=${until}`)
  } else if (r.count) parts.push(`COUNT=${r.count}`)
  return parts.join(';')
}

const EDITABLE = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST'])

/**
 * Parse an RRULE ("RRULE:" optional). Anything the app can't edit becomes `{ freq, rule }`, kept as-is.
 * `start` (the series' first start) turns a timed UNTIL into the last day that still has an occurrence.
 */
export function fromRRule(text: string, start?: string): Recurrence {
  const rule = text.replace(/^RRULE:/i, '').trim()
  const kv = new Map(rule.split(';').filter(Boolean).map((p) => {
    const i = p.indexOf('=')
    return [p.slice(0, i).toUpperCase(), p.slice(i + 1).toUpperCase()] as const
  }))
  const freq = (kv.get('FREQ') ?? '').toLowerCase() as Recurrence['freq']
  const custom = (): Recurrence => ({ freq: FREQS.includes(freq) ? freq : 'daily', rule })
  if (!FREQS.includes(freq) || [...kv.keys()].some((k) => !EDITABLE.has(k))) return custom()
  const out: Recurrence = { freq }
  const interval = Number(kv.get('INTERVAL') ?? 1)
  if (!Number.isInteger(interval) || interval < 1) return custom()
  if (interval > 1) out.interval = interval
  if (kv.has('BYDAY')) {
    const days = kv.get('BYDAY')!.split(',')
    if (freq !== 'weekly' || days.some((d) => !WEEKDAYS.includes(d as Weekday))) return custom()
    out.byDay = WEEKDAYS.filter((d) => days.includes(d))
  }
  const until = kv.get('UNTIL')
  if (until) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(until)
    if (!m) return custom()
    if (!m[4]) out.until = `${m[1]}-${m[2]}-${m[3]}`
    else {
      const at = m[7]
        ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
        : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
      // Cut right before an occurrence (e.g. "end the series here"): the last one is the day before.
      const s = start && start.length > 10 ? asDate(start) : undefined
      const minutes = (d: Date): number => d.getHours() * 60 + d.getMinutes()
      if (s && minutes(at) < minutes(s)) at.setDate(at.getDate() - 1)
      out.until = format(at, 'yyyy-MM-dd')
    }
  } else if (kv.has('COUNT')) {
    const count = Number(kv.get('COUNT'))
    if (!Number.isInteger(count) || count < 1) return custom()
    out.count = count
  }
  return out
}

export type PresetId = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom'
export interface Preset {
  id: Exclude<PresetId, 'custom'>
  label: string
  recurrence: Recurrence | null
}

/** The quick choices for an event starting at `start`. */
export function presets(start: string): Preset[] {
  const d = asDate(start)
  return [
    { id: 'none', label: 'Does not repeat', recurrence: null },
    { id: 'daily', label: 'Every day', recurrence: { freq: 'daily' } },
    { id: 'weekly', label: `Every week on ${format(d, 'EEEE')}`, recurrence: { freq: 'weekly' } },
    { id: 'monthly', label: `Every month on day ${d.getDate()}`, recurrence: { freq: 'monthly' } },
    { id: 'yearly', label: `Every year on ${format(d, 'd MMMM')}`, recurrence: { freq: 'yearly' } },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)', recurrence: { freq: 'weekly', byDay: WORKWEEK } }
  ]
}

/** Which preset `r` is (its end ignored), else 'custom'. */
export function presetOf(r: Recurrence | null, start: string): PresetId {
  if (!r) return 'none'
  if (r.rule) return 'custom'
  const { until: _u, count: _c, ...base } = normalize(r, start)
  const hit = presets(start).find((p) => p.recurrence && JSON.stringify(normalize(p.recurrence, start)) === JSON.stringify(base))
  return hit?.id ?? 'custom'
}

/** Keep the end (until/count) of `from` on a newly picked rule. */
export const withEnd = (r: Recurrence, from: Recurrence | null): Recurrence =>
  from?.until ? { ...r, until: from.until, count: undefined } : from?.count ? { ...r, count: from.count, until: undefined } : r

/** "Every 2 weeks on Mon, Thu · until 31 Dec 2026". */
export function describe(r: Recurrence | null, start: string): string {
  if (!r) return 'Does not repeat'
  if (r.rule) return `Custom rule (${r.rule})`
  const n = normalize(r, start)
  const d = asDate(start)
  const every = n.interval ? `Every ${n.interval} ${UNIT[n.freq]}s` : `Every ${UNIT[n.freq]}`
  const on =
    n.freq === 'weekly'
      ? !n.interval && n.byDay?.join() === WORKWEEK.join()
        ? ''
        : ` on ${(n.byDay ?? [weekdayOf(start)]).map(shortDay).join(', ')}`
      : n.freq === 'monthly'
        ? ` on day ${d.getDate()}`
        : n.freq === 'yearly'
          ? ` on ${format(d, 'd MMMM')}`
          : ''
  const head = n.freq === 'weekly' && !n.interval && n.byDay?.join() === WORKWEEK.join() ? 'Every weekday (Mon–Fri)' : `${every}${on}`
  const end = n.until ? ` · until ${format(parseISO(n.until), 'd MMM yyyy')}` : n.count ? ` · ${n.count} time${n.count > 1 ? 's' : ''}` : ''
  return head + end
}

// ---- Terminal text fields ("2 weeks", "mo th", "never" / "2026-12-31" / "10 times") ----

export const everyText = (r: Recurrence): string => `${r.interval ?? 1} ${UNIT[r.freq]}${(r.interval ?? 1) > 1 ? 's' : ''}`

/** "2 weeks" / "day" / "3 months" -> interval + freq. Throws a user-facing Error. */
export function parseEvery(text: string): Pick<Recurrence, 'freq' | 'interval'> {
  const m = /^\s*(\d+)?\s*(day|week|month|year)s?\s*$/i.exec(text)
  const n = Number(m?.[1] ?? 1)
  if (!m || n < 1 || n > 999) throw new Error('Repeat every: use e.g. "2 weeks" (day, week, month or year)')
  const freq = FREQS.find((f) => UNIT[f] === m[2].toLowerCase())!
  return { freq, interval: n > 1 ? n : undefined }
}

export const daysText = (days: Weekday[]): string => days.map((d) => d.toLowerCase()).join(' ')

/** "mo th" / "Mon, Thu" -> weekdays. Throws a user-facing Error. */
export function parseDays(text: string): Weekday[] {
  const words = text.split(/[\s,;]+/).filter(Boolean).map((w) => w.slice(0, 2).toUpperCase())
  const bad = words.filter((w) => !WEEKDAYS.includes(w as Weekday))
  if (!words.length || bad.length) throw new Error('Repeat on: use days like "mo th"')
  return WEEKDAYS.filter((d) => words.includes(d))
}

export const endsText = (r: Recurrence): string => (r.until ? r.until : r.count ? `${r.count} times` : 'never')

/** "never" / "2026-12-31" / "10 times" -> the end. Throws a user-facing Error. */
export function parseEnds(text: string): Pick<Recurrence, 'until' | 'count'> {
  const t = text.trim().toLowerCase()
  if (!t || t === 'never') return {}
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) && isValid(parseISO(t)) && format(parseISO(t), 'yyyy-MM-dd') === t) return { until: t }
  const m = /^(\d+)(\s*times?)?$/.exec(t)
  if (m && +m[1] >= 1 && +m[1] <= 999) return { count: +m[1] }
  throw new Error('Ends: use "never", a date (YYYY-MM-DD) or "10 times"')
}
