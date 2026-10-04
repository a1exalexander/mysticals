import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { IPC, type LocaleState } from '@shared/ipc'
import { isLocaleSetting, LOCALES, resolveLocale, type Locale, type LocaleSetting } from '@mysticals/core/i18n'
import { readPrefs, writePrefs } from './prefs'
import { buildMenu } from './menu'

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

/** Resolves the language, sets the menu and serves Settings > Language. Call after app ready. */
export function startLocale(): void {
  current = forced() ?? resolveLocale(setting(), osLanguages())
  Menu.setApplicationMenu(buildMenu(current))
  ipcMain.handle(IPC.localeGet, state)
  ipcMain.handle(IPC.localeSet, (_e, next: unknown) => {
    if (!isLocaleSetting(next)) throw new Error(`unknown language: ${String(next)}`)
    writePrefs({ language: next })
    current = forced() ?? resolveLocale(next, osLanguages())
    Menu.setApplicationMenu(buildMenu(current))
    const s = state()
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.locale, s)
    return s
  })
}
