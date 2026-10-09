// Clock preferences: 24- or 12-hour times and the first day of the week. Pure; the desktop app resolves
// "auto" from the OS region, the terminal app uses the defaults (24-hour, Monday).
import { getISOWeek, getWeek } from 'date-fns'

export type TimeFormat = 'auto' | '24' | '12'
export type WeekStart = 'auto' | 'mon' | 'sun'
export const TIME_FORMATS: readonly TimeFormat[] = ['auto', '24', '12']
export const WEEK_STARTS: readonly WeekStart[] = ['auto', 'mon', 'sun']
export const isTimeFormat = (v: unknown): v is TimeFormat => TIME_FORMATS.includes(v as TimeFormat)
export const isWeekStart = (v: unknown): v is WeekStart => WEEK_STARTS.includes(v as WeekStart)

/** date-fns pattern of a clock time: "14:05" or "2:05 PM". */
export const timePattern = (hour12 = false): string => (hour12 ? 'h:mm a' : 'HH:mm')
/** date-fns pattern of a whole-hour label: "09:00" or "9 AM". */
export const hourPattern = (hour12 = false): string => (hour12 ? 'h a' : 'HH:mm')

type WeekInfoLocale = Intl.Locale & {
  getHourCycles?: () => string[]
  hourCycles?: string[]
  getWeekInfo?: () => { firstDay: number }
  weekInfo?: { firstDay: number }
}
const localeOf = (tag: string): WeekInfoLocale | undefined => {
  try {
    return new Intl.Locale(tag) as WeekInfoLocale
  } catch {
    // empty or malformed tag
    return undefined
  }
}

/** Whether the region of OS locale `tag` (e.g. "en-US") uses a 12-hour clock (h11/h12). */
export function regionHour12(tag: string): boolean {
  const l = localeOf(tag)
  if (!l) return false
  // The region's own cycle: "en-UA" is 24-hour, though English alone would say 12.
  const cycle = (l.getHourCycles?.() ?? l.hourCycles)?.[0] ?? new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle
  return cycle === 'h11' || cycle === 'h12'
}

/** First day of the week in the region of OS locale `tag`: 0 Sunday, else 1 Monday (Saturday regions too). */
export function regionWeekStartsOn(tag: string): 0 | 1 {
  const l = localeOf(tag)
  return (l?.getWeekInfo?.() ?? l?.weekInfo)?.firstDay === 7 ? 0 : 1
}

/** Week number: ISO with a Monday start, US-style (week 1 holds 1 January) with a Sunday start. */
export const weekNumber = (d: Date, weekStartsOn: 0 | 1 = 1): number =>
  weekStartsOn === 1 ? getISOWeek(d) : getWeek(d, { weekStartsOn: 0, firstWeekContainsDate: 1 })

// am/pm, a.m., or Ukrainian дп/пп
const TYPED = /^(\d{1,2}):?([0-5]\d)?\s*(?:([apдп])\.?\s*[mп]?\.?)?$/i

/** A typed time → 'HH:mm': "9:30", "0930", "21:30", and with am/pm "9:30 pm", "9pm", "12am", "9 пп"; null when not a time. */
export function parseTime(s: string): string | null {
  const m = TYPED.exec(s.trim())
  if (!m || (!m[2] && !m[3])) return null
  let h = Number(m[1])
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (/[pп]/i.test(m[3]) ? 12 : 0)
  } else if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`
}
