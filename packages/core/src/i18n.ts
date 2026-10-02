// UI language: message lookup, plurals and date formatting. Pure; the apps decide which locale is active.
import { format } from 'date-fns'
import { enUS, uk as ukDates } from 'date-fns/locale'
import { en, type Key } from './i18n/en'
import { uk } from './i18n/uk'

export type { Key } from './i18n/en'
export type Locale = 'en' | 'uk'
export type LocaleSetting = Locale | 'auto'
export const LOCALES: Locale[] = ['en', 'uk']
/** Each language named in itself, for the picker. */
export const LOCALE_NAME: Record<Locale, string> = { en: 'English', uk: 'Українська' }

/** A string with `{name}` placeholders, or plural forms picked by the `n` param. */
export type Msg = string | ({ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>)
export type Params = Record<string, string | number>

const DICT: Record<Locale, Record<Key, Msg>> = { en, uk }
const plurals = new Map<Locale, Intl.PluralRules>()
const pluralOf = (locale: Locale, n: number): Intl.LDMLPluralRule => {
  if (!plurals.has(locale)) plurals.set(locale, new Intl.PluralRules(locale))
  return plurals.get(locale)!.select(n)
}

/** Message `key` in `locale` with `{name}` filled from `params`; plural forms choose by `params.n`. */
export function t(locale: Locale, key: Key, params?: Params): string {
  const msg = DICT[locale][key] ?? en[key]
  const text = typeof msg === 'string' ? msg : (msg[pluralOf(locale, Number(params?.n ?? 0))] ?? msg.other)
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text
}

export const dateLocale = (locale: Locale): typeof enUS => (locale === 'uk' ? ukDates : enUS)

/**
 * date-fns `format` with the locale's month and day names. Ukrainian short weekdays are the
 * two-letter "пн", not date-fns' "пнд", so `EEE` becomes `EEEEEE` there.
 */
export const fmt = (locale: Locale, date: Date | number, pattern: string): string =>
  format(date, locale === 'uk' ? pattern.replace(/(?<!E)EEE(?!E)/g, 'EEEEEE') : pattern, { locale: dateLocale(locale) })

/** The language to use: an explicit choice, else the first OS language we have, else English. */
export function resolveLocale(setting: LocaleSetting | undefined, system: readonly string[]): Locale {
  if (setting && setting !== 'auto' && LOCALES.includes(setting)) return setting
  for (const tag of system) {
    const base = tag.toLowerCase().split(/[-_]/)[0] as Locale
    if (LOCALES.includes(base)) return base
  }
  return 'en'
}

export const isLocaleSetting = (v: unknown): v is LocaleSetting => v === 'auto' || LOCALES.includes(v as Locale)
