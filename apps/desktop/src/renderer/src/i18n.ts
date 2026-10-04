import { useSyncExternalStore } from 'react'
import type { LocaleState } from '@shared/ipc'
import * as core from '@mysticals/core/i18n'
import type { Key, LocaleSetting, Params } from '@mysticals/core/i18n'

// The UI language comes from the main process (Settings > Language, else the OS) so menus,
// notifications and the window agree. `t`/`fmt` read the current one; components call
// `useLocale()` so they re-render when it changes.

let state: LocaleState = { setting: 'auto', locale: 'en', system: 'en' }
const subs = new Set<() => void>()

function apply(next: LocaleState): void {
  state = next
  document.documentElement.lang = next.locale
  subs.forEach((f) => f())
}

/** Load the language before the first render, then follow changes. */
export async function initLocale(): Promise<void> {
  try {
    apply(await window.locale.get())
  } catch {
    // no main-process handler (should not happen): stay English
  }
  window.locale.onChange(apply)
}

export const setLanguage = (setting: LocaleSetting): Promise<void> => window.locale.set(setting).then(apply)

export const t = (key: Key, params?: Params): string => core.t(state.locale, key, params)
export const fmt = (date: Date | number, pattern: string): string => core.fmt(state.locale, date, pattern)
/** Ukrainian month names are lowercase; a heading starts with a capital. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
export const currentLocale = (): core.Locale => state.locale
export const dateLocale = (): ReturnType<typeof core.dateLocale> => core.dateLocale(state.locale)

export const useLocale = (): LocaleState =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state
  )
