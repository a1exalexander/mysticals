import { describe, expect, it } from 'vitest'
import { fmt } from '../i18n'
import { hourPattern, isTimeFormat, isWeekStart, parseTime, regionHour12, regionWeekStartsOn, timePattern, weekNumber } from './clock'

describe('regionHour12', () => {
  it('reads the region hour cycle (h11/h12 → 12-hour)', () => {
    expect(regionHour12('en-US')).toBe(true)
    expect(regionHour12('en-GB')).toBe(false)
    expect(regionHour12('uk-UA')).toBe(false)
    // English in Ukraine: the region decides, not the language.
    expect(regionHour12('en-UA')).toBe(false)
  })
  it('falls back to 24-hour for a malformed tag', () => {
    expect(regionHour12('')).toBe(false)
    expect(regionHour12('en_US')).toBe(false)
  })
})

describe('regionWeekStartsOn', () => {
  it('maps weekInfo firstDay 7 to Sunday and anything else to Monday', () => {
    expect(regionWeekStartsOn('en-US')).toBe(0)
    expect(regionWeekStartsOn('pt-BR')).toBe(0)
    expect(regionWeekStartsOn('en-GB')).toBe(1)
    expect(regionWeekStartsOn('uk-UA')).toBe(1)
    expect(regionWeekStartsOn('ar-EG')).toBe(1) // Saturday region
    expect(regionWeekStartsOn('')).toBe(1)
  })
})

describe('time patterns', () => {
  const d = new Date(2026, 9, 9, 21, 5)
  it('formats 24- and 12-hour clocks', () => {
    expect(fmt('en', d, timePattern())).toBe('21:05')
    expect(fmt('en', d, timePattern(true))).toBe('9:05 PM')
    expect(fmt('en', new Date(2026, 9, 9, 9), hourPattern())).toBe('09:00')
    expect(fmt('en', new Date(2026, 9, 9, 9), hourPattern(true))).toBe('9 AM')
  })
  it('validates stored settings', () => {
    expect(isTimeFormat('12')).toBe(true)
    expect(isTimeFormat('h12')).toBe(false)
    expect(isWeekStart('sun')).toBe(true)
    expect(isWeekStart(0)).toBe(false)
  })
})

describe('weekNumber', () => {
  it('is ISO with Monday, US-style with Sunday', () => {
    const sun = new Date(2026, 0, 4) // Sunday 4 Jan 2026: ISO week 1 still (Mon 29 Dec – Sun 4 Jan)
    expect(weekNumber(sun)).toBe(1)
    expect(weekNumber(sun, 0)).toBe(2)
    expect(weekNumber(new Date(2026, 0, 1), 0)).toBe(1)
  })
})

describe('parseTime', () => {
  it('reads 24-hour times', () => {
    expect(parseTime('9:30')).toBe('09:30')
    expect(parseTime(' 0930 ')).toBe('09:30')
    expect(parseTime('21:05')).toBe('21:05')
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('9:60')).toBeNull()
    expect(parseTime('9')).toBeNull()
  })
  it('reads am/pm', () => {
    expect(parseTime('9:30 pm')).toBe('21:30')
    expect(parseTime('9:30 PM')).toBe('21:30')
    expect(parseTime('9pm')).toBe('21:00')
    expect(parseTime('9 a.m.')).toBe('09:00')
    expect(parseTime('12am')).toBe('00:00')
    expect(parseTime('12:15 pm')).toBe('12:15')
    expect(parseTime('13:00 pm')).toBeNull()
    expect(parseTime('0:30 am')).toBeNull()
    expect(parseTime('9:30 ПП')).toBe('21:30')
    expect(parseTime('9 дп')).toBe('09:00')
  })
})
