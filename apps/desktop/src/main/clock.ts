import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC, type ClockState } from '@shared/ipc'
import { isTimeFormat, isWeekStart, regionHour12, regionWeekStartsOn } from '@mysticals/core/logic/clock'
import { readPrefs, writePrefs } from './prefs'

// Mock runs (e2e) see a 24-hour, Monday-first region so specs don't depend on the machine they run on.
const system = (): ClockState['system'] => {
  if (process.env.MYSTICALS_MOCK === '1') return { hour12: false, weekStartsOn: 1 }
  const region = app.getSystemLocale()
  return { hour12: regionHour12(region), weekStartsOn: regionWeekStartsOn(region) }
}

const state = (): ClockState => {
  const p = readPrefs()
  const timeFormat = isTimeFormat(p.timeFormat) ? p.timeFormat : 'auto'
  const weekStart = isWeekStart(p.weekStart) ? p.weekStart : 'auto'
  const sys = system()
  return {
    timeFormat,
    weekStart,
    hour12: timeFormat === 'auto' ? sys.hour12 : timeFormat === '12',
    weekStartsOn: weekStart === 'auto' ? sys.weekStartsOn : weekStart === 'sun' ? 0 : 1,
    system: sys
  }
}

let current: ClockState | undefined

/** 12-hour times in notifications. Valid after `startClock`. */
export const hour12 = (): boolean => current?.hour12 ?? false

/** Resolves Auto from the OS region and serves Settings > General time format and week start. Call after app ready. */
export function startClock(): void {
  current = state()
  ipcMain.handle(IPC.clockGet, () => current)
  ipcMain.handle(IPC.clockSet, (_e, patch: unknown) => {
    const { timeFormat, weekStart } = (patch ?? {}) as Record<string, unknown>
    if (timeFormat !== undefined && !isTimeFormat(timeFormat)) throw new Error(`unknown time format: ${String(timeFormat)}`)
    if (weekStart !== undefined && !isWeekStart(weekStart)) throw new Error(`unknown week start: ${String(weekStart)}`)
    writePrefs({ ...(timeFormat ? { timeFormat } : {}), ...(weekStart ? { weekStart } : {}) })
    current = state()
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.clock, current)
    return current
  })
}
