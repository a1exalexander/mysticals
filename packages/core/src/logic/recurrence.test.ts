import { describe, expect, it } from 'vitest'
import {
  describe as text, fromRRule, normalize, parseDays, parseEnds, parseEvery, presetOf, presets, sameRecurrence, toRRule
} from './recurrence'

const WED = '2026-09-30T09:00' // a Wednesday, local

describe('toRRule / fromRRule', () => {
  it('round-trips the editable subset', () => {
    for (const r of [
      { freq: 'daily' as const },
      { freq: 'weekly' as const, interval: 2, byDay: ['MO' as const, 'TH' as const] },
      { freq: 'monthly' as const, count: 10 },
      { freq: 'yearly' as const, until: '2030-01-01' }
    ]) expect(fromRRule(toRRule(r, true))).toEqual(r)
  })

  it('writes UNTIL as a DATE for all-day and as the end of the local day in UTC for timed events', () => {
    expect(toRRule({ freq: 'daily', until: '2026-12-31' }, true)).toBe('FREQ=DAILY;UNTIL=20261231')
    const until = new Date('2026-12-31T23:59:59').toISOString().replace(/[-:]|\.\d{3}/g, '')
    expect(toRRule({ freq: 'daily', until: '2026-12-31' }, false)).toBe(`FREQ=DAILY;UNTIL=${until}`)
    expect(fromRRule(`RRULE:FREQ=DAILY;UNTIL=${until}`, WED)).toEqual({ freq: 'daily', until: '2026-12-31' })
  })

  it('reads a cut made right before an occurrence as ending the day before', () => {
    const cut = new Date('2026-10-05T08:59:59').toISOString().replace(/[-:]|\.\d{3}/g, '')
    expect(fromRRule(`FREQ=DAILY;UNTIL=${cut}`, WED).until).toBe('2026-10-04')
  })

  it('keeps rules it cannot edit as-is', () => {
    expect(fromRRule('RRULE:FREQ=MONTHLY;BYDAY=2TU')).toEqual({ freq: 'monthly', rule: 'FREQ=MONTHLY;BYDAY=2TU' })
    expect(fromRRule('FREQ=HOURLY')).toEqual({ freq: 'daily', rule: 'FREQ=HOURLY' })
    expect(toRRule({ freq: 'monthly', rule: 'FREQ=MONTHLY;BYDAY=2TU' }, false)).toBe('FREQ=MONTHLY;BYDAY=2TU')
  })
})

describe('presets', () => {
  it('names the choices after the start', () => {
    expect(presets(WED).map((p) => p.label)).toEqual([
      'Does not repeat', 'Every day', 'Every week on Wednesday', 'Every month on day 30', 'Every year on 30 September', 'Every weekday (Mon–Fri)'
    ])
  })
  it('finds the preset of a rule, ignoring its end', () => {
    expect(presetOf(null, WED)).toBe('none')
    expect(presetOf({ freq: 'weekly', byDay: ['WE'], count: 3 }, WED)).toBe('weekly')
    expect(presetOf({ freq: 'weekly', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, WED)).toBe('weekdays')
    expect(presetOf({ freq: 'weekly', interval: 2 }, WED)).toBe('custom')
  })
})

describe('normalize / sameRecurrence', () => {
  it('treats the implicit start weekday and interval 1 as the same rule', () => {
    expect(normalize({ freq: 'weekly', interval: 1, byDay: ['WE'] }, WED)).toEqual({ freq: 'weekly' })
    expect(sameRecurrence({ freq: 'weekly' }, { freq: 'weekly', byDay: ['WE'] }, WED)).toBe(true)
    expect(sameRecurrence({ freq: 'weekly' }, { freq: 'weekly', count: 2 }, WED)).toBe(false)
    expect(sameRecurrence(null, null, WED)).toBe(true)
    expect(sameRecurrence(null, { freq: 'daily' }, WED)).toBe(false)
    expect(sameRecurrence(undefined, null, WED)).toBe(false)
  })
})

describe('describe', () => {
  it('reads like a sentence', () => {
    expect(text({ freq: 'weekly', interval: 2, byDay: ['MO', 'TH'], until: '2026-12-31' }, WED)).toBe('Every 2 weeks on Mon, Thu · until 31 Dec 2026')
    expect(text({ freq: 'daily', count: 1 }, WED)).toBe('Every day · 1 time')
    expect(text({ freq: 'weekly', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, WED)).toBe('Every weekday (Mon–Fri)')
    expect(text({ freq: 'monthly' }, WED)).toBe('Every month on day 30')
  })
  it('reads in Ukrainian', () => {
    expect(text({ freq: 'weekly', interval: 2, byDay: ['MO', 'TH'], until: '2026-12-31' }, WED, 'uk')).toBe('Кожні 2 тижні у пн, чт · до 31 груд. 2026')
    expect(text({ freq: 'daily', count: 5 }, WED, 'uk')).toBe('Щодня · 5 разів')
    expect(text({ freq: 'weekly', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, WED, 'uk')).toBe('У будні (пн–пт)')
    expect(text({ freq: 'yearly' }, WED, 'uk')).toBe('Щороку 30 вересня')
    expect(presets(WED, 'uk').map((p) => p.label)).toEqual([
      'Не повторюється', 'Щодня', 'Щотижня у середу', 'Щомісяця 30-го числа', 'Щороку 30 вересня', 'У будні (пн–пт)'
    ])
  })
})

describe('terminal text fields', () => {
  it('parses every / days / ends', () => {
    expect(parseEvery('2 weeks')).toEqual({ freq: 'weekly', interval: 2 })
    expect(parseEvery('day')).toEqual({ freq: 'daily', interval: undefined })
    expect(() => parseEvery('often')).toThrow(/Repeat every/)
    expect(parseDays('th, Mon')).toEqual(['MO', 'TH'])
    expect(() => parseDays('xx')).toThrow(/Repeat on/)
    expect(parseEnds('never')).toEqual({})
    expect(parseEnds('2026-12-31')).toEqual({ until: '2026-12-31' })
    expect(parseEnds('10 times')).toEqual({ count: 10 })
    expect(() => parseEnds('2026-02-31')).toThrow(/Ends/)
  })
})
