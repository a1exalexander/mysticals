import { app, Menu } from 'electron'
import { Effect, Schema } from 'effect'
import { IPC, type LocaleState } from '@shared/ipc'
import { isLocaleSetting, LOCALES, resolveLocale, type Locale, type LocaleSetting } from '@mysticals/core/i18n'
import { readPrefs, writePrefs } from './prefs'
import { buildMenu } from './menu'
import { handle, AnyArgs } from './ipc/register'
import { broadcast } from './window'

/** MYSTICALS_LANG=en|uk wins over Settings and the OS (e2e pins English with it). */
const forced = (): Locale | undefined => LOCALES.find((l) => l === process.env.MYSTICALS_LANG)

const setting = (): LocaleSetting => {
  const v = readPrefs().language
  return isLocaleSetting(v) ? v : 'auto'
}

// Mock runs (e2e) see an English OS so specs don't depend on the machine they run on.
const osLanguages = (): string[] => (process.env.MYSTICALS_MOCK === '1' ? ['en'] : app.getPreferredSystemLanguages())
const system = (): Locale => resolveLocale('auto', osLanguages())

let current: Locale = 'en'

/** The UI language now in use. Valid after `startLocale`. */
export const currentLocale = (): Locale => current

const state = (): LocaleState => ({ setting: setting(), locale: current, system: system() })

/** Resolves the language, sets the menu and serves Settings > Language. Call after app ready and `loadPrefs`. */
export const startLocale = Effect.gen(function* () {
  current = forced() ?? resolveLocale(setting(), osLanguages())
  Menu.setApplicationMenu(buildMenu(current))
  yield* handle(IPC.localeGet, AnyArgs, () => Effect.sync(state))
  yield* handle(
    IPC.localeSet,
    Schema.Tuple([Schema.declare(isLocaleSetting)]),
    ([next]) =>
      Effect.gen(function* () {
        yield* writePrefs({ language: next })
        current = forced() ?? resolveLocale(next, osLanguages())
        Menu.setApplicationMenu(buildMenu(current))
        const s = state()
        broadcast(IPC.locale, s)
        return s
      }),
    ([next]) => `unknown language: ${String(next)}`
  )
})
