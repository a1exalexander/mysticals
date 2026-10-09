import { describe, expect, it } from 'vitest'
import { fmt, isKey, resolveLocale, t } from './i18n'
import { en } from './i18n/en'
import { uk } from './i18n/uk'

describe('t', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(t('en', 'status.at', { time: '14:00' })).toBe('at 14:00')
    expect(t('uk', 'status.at', { time: '14:00' })).toBe('о 14:00')
    expect(t('en', 'status.at')).toBe('at {time}')
  })

  it('picks Ukrainian plural forms by n', () => {
    const times = (n: number): string => t('uk', 'repeat.count', { n })
    expect([1, 2, 5, 11, 21, 22, 25].map(times)).toEqual(['1 раз', '2 рази', '5 разів', '11 разів', '21 раз', '22 рази', '25 разів'])
    expect(t('en', 'repeat.count', { n: 1 })).toBe('1 time')
    expect(t('en', 'repeat.count', { n: 21 })).toBe('21 times')
  })

  it('has every English key in Ukrainian, with the same placeholders', () => {
    const names = (m: unknown): string[] => [...new Set(JSON.stringify(m).match(/\{\w+\}/g) ?? [])].sort()
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(uk[k], k).toBeDefined()
      expect(names(uk[k]), k).toEqual(names(en[k]))
    }
  })
})

describe('isKey', () => {
  it('knows messages and nothing else', () => {
    expect(isKey('partstat.accepted')).toBe(true)
    expect(isKey('partstat.maybe')).toBe(false)
    expect(isKey('constructor')).toBe(false)
  })
})

describe('fmt', () => {
  it('uses Ukrainian month and two-letter day names', () => {
    const d = new Date(2026, 9, 2)
    expect(fmt('uk', d, 'EEE, d MMM')).toBe('пт, 2 жовт.')
    expect(fmt('uk', d, 'd MMMM')).toBe('2 жовтня')
    expect(fmt('uk', d, 'LLLL yyyy')).toBe('жовтень 2026')
    expect(fmt('en', d, 'EEE, d MMM')).toBe('Fri, 2 Oct')
  })
})

describe('resolveLocale', () => {
  it('takes an explicit choice, else the first OS language we have, else English', () => {
    expect(resolveLocale('uk', ['en-US'])).toBe('uk')
    expect(resolveLocale('en', ['uk-UA'])).toBe('en')
    expect(resolveLocale('auto', ['uk-UA', 'en-US'])).toBe('uk')
    expect(resolveLocale('auto', ['de-DE', 'uk_UA'])).toBe('uk')
    expect(resolveLocale('auto', ['de-DE', 'fr'])).toBe('en')
    expect(resolveLocale(undefined, [])).toBe('en')
  })
})
