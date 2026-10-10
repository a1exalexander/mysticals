import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, ipcMain, Notification, powerMonitor, shell } from 'electron'
import { IPC, type Api, type ReminderMeeting } from '@shared/ipc'
import type { Account, Calendar, CalEvent, LogEntry } from '@shared/types'
import { snap } from '@mysticals/core/logic/activity'
import { DEFAULT_REMINDER_MIN, dueReminders, isReminderMin, loadReminded, pruneReminded, REMINDED_KEEP_MS, reminderKey, reminderText, screenMeetings, splitReminders } from '@mysticals/core/logic/reminders'
import { visibleEvents } from '@mysticals/core/logic/visible'
import { eventMeetingUrl } from '@mysticals/core/logic/meeting'
import { t } from '@mysticals/core/i18n'
import { currentLocale } from './locale'
import { hour12 } from './clock'
import { readPrefs, writePrefs } from './prefs'
import { keepSpareScreen, showReminderScreen, startReminderScreen } from './reminderWindow'
import { playSound, reminderSound, warmSound } from './sound'

const TICK_MS = 20_000

/** Settings > Notifications: minutes before an event, 0 = off. */
export const reminderMin = (): number => {
  const v = readPrefs().reminderMin
  return isReminderMin(v) ? v : DEFAULT_REMINDER_MIN
}

/** Settings > Notifications: ids of the accounts that stay silent (reminders and invite/change banners). */
export const mutedAccounts = (): Set<string> => {
  const v = readPrefs().notifyOff
  return new Set(Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [])
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Settings > Notifications: full-screen reminder for events with a Call link, off by default. */
export const fullscreenReminder = (): boolean => readPrefs().fullscreenReminder === true

/** Once the main window is up: the sound and Full-screen reminder windows load ahead, so neither lags when due. */
export function warmReminders(): void {
  warmSound()
  keepSpareScreen(fullscreenReminder())
}

const meeting = (e: CalEvent, url: string, calendars: Calendar[], accounts: Account[]): ReminderMeeting => {
  const account = accounts.find((a) => a.id === e.accountId)
  const color = calendars.find((c) => c.accountId === e.accountId && c.id === e.calendarId)?.color ?? account?.color ?? ''
  return { key: reminderKey(e), title: e.title, start: e.start, end: e.end, color, account: account?.label ?? '', url }
}

// Held until closed/clicked: a GC'd Notification drops its click/action handlers.
const banners = new Set<Notification>()

/**
 * Pops a system notification `reminderMin` minutes before each upcoming event while the app runs. Clicking it (or its
 * macOS "Join" button) opens the event's call link; without one it brings the app forward. With the Full-screen reminder
 * on, events with a Call link go on that screen instead, all due ones together. Polls the cached events,
 * so synced changes and moved events need no re-arming. Muted accounts, hidden calendars, declined and all-day events stay
 * silent.
 */
export function startReminders(api: Pick<Api, 'events' | 'calendars' | 'accounts'>, showMain: () => void, log?: (e: LogEntry) => void): void {
  ipcMain.handle(IPC.remindersGet, reminderMin)
  ipcMain.handle(IPC.remindersSet, (_e, min: unknown) => {
    if (!isReminderMin(min)) throw new Error(`Invalid reminder: ${String(min)}`)
    writePrefs({ reminderMin: min })
    void tick()
  })
  ipcMain.handle(IPC.remindersMutedGet, () => [...mutedAccounts()])
  ipcMain.handle(IPC.remindersMutedSet, (_e, id: unknown, muted: unknown) => {
    if (typeof id !== 'string' || typeof muted !== 'boolean') throw new Error('Invalid account mute')
    const off = mutedAccounts()
    if (muted) off.add(id)
    else off.delete(id)
    writePrefs({ notifyOff: [...off] })
  })
  ipcMain.handle(IPC.remindersFullscreenGet, fullscreenReminder)
  ipcMain.handle(IPC.remindersFullscreenSet, (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Invalid full-screen reminder')
    writePrefs({ fullscreenReminder: on })
    keepSpareScreen(on)
    void tick()
  })
  ipcMain.handle(IPC.remindersSoundGet, reminderSound)
  ipcMain.handle(IPC.remindersSoundSet, (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Invalid reminder sound')
    writePrefs({ reminderSound: on })
  })
  ipcMain.handle(IPC.remindersSoundTest, () => playSound(fullscreenReminder() ? 'bell' : 'chime', true))
  // Built here, not taken from the renderer: Join opens the meeting's url.
  ipcMain.handle(IPC.remindersPreview, () => {
    const start = Date.now() + Math.max(reminderMin(), 1) * 60_000
    void playSound('bell')
    return showReminderScreen([
      { key: 'preview', title: t(currentLocale(), 'reminder.preview'), start: new Date(start).toISOString(), end: new Date(start + 30 * 60_000).toISOString(), color: '', account: 'Mysticals', url: 'https://meet.google.com/' }
    ])
  })

  // reminder key → event start (ms), to forget old ones. On disk so a restart inside the reminder window stays quiet.
  const sentFile = join(app.getPath('userData'), 'reminded.json')
  const sent = loadReminded(readJson(sentFile), Date.now())
  const saveSent = (): void => {
    try {
      writeFileSync(sentFile, JSON.stringify(Object.fromEntries(sent)))
    } catch (e) {
      console.error('saving reminded keys failed', e)
    }
  }
  // Meetings on the open full-screen reminder; empty while it is closed.
  let onScreen: CalEvent[] = []
  startReminderScreen(() => (onScreen = []))
  let busy = false
  const tick = async (): Promise<void> => {
    const lead = reminderMin()
    // An open screen still needs ticks to drop ended or cancelled meetings.
    if (busy || (!lead && !onScreen.length)) return
    busy = true
    try {
      const now = new Date()
      const range = { start: new Date(now.getTime() - REMINDED_KEEP_MS).toISOString(), end: new Date(now.getTime() + (lead + 1) * 60_000).toISOString() }
      const [events, calendars, accounts] = await Promise.all([api.events.list(range), api.calendars.list(), api.accounts.list()])
      const changed = pruneReminded(sent, now.getTime())
      const muted = mutedAccounts()
      const shown = visibleEvents(events, calendars).filter((e) => !muted.has(e.accountId))
      const due = dueReminders(shown, now, lead, new Set(sent.keys()))
      // Reminded once shown: every meeting on a dismissed screen counts too.
      for (const e of due) sent.set(reminderKey(e), new Date(e.start).getTime())
      if (due.length || changed) saveSent()
      const split = splitReminders(due, fullscreenReminder())
      const record = (e: CalEvent, mode: string): void =>
        log?.({ at: now.toISOString(), accountId: e.accountId, email: accounts.find((a) => a.id === e.accountId)?.email ?? '', kind: 'reminder', ok: true, event: snap(e), detail: { mode, minutes: lead } })
      for (const e of split.banner) record(e, 'banner')
      for (const e of split.fullscreen) record(e, 'fullscreen')
      const popped = Notification.isSupported() ? split.banner : []
      for (const e of popped) show(reminderText(e, now, currentLocale(), hour12()))
      // One sound per tick, however many are due; the screen's bell wins over the Banner chime.
      if (split.fullscreen.length) void playSound('bell')
      else if (popped.length) void playSound('chime')
      const next = screenMeetings(onScreen, split.fullscreen, shown, now)
      if (!onScreen.length && !next.length) return
      // No await from here on: a dismiss in between would be undone.
      onScreen = next
      const list = next.flatMap((e) => {
        const url = eventMeetingUrl(e)
        return url ? [meeting(e, url, calendars, accounts)] : []
      })
      void showReminderScreen(list)
    } catch (e) {
      console.error('reminders failed', e)
    } finally {
      busy = false
    }
  }

  const show = ({ title, body, join }: ReturnType<typeof reminderText>): void => {
    // Stays until dismissed on Windows/Linux (critical: GNOME ignores timeouts); macOS takes it from Info.plist. Silent: playSound() rings instead.
    const n = new Notification({ title, body, actions: join ? [{ type: 'button', text: join.label }] : [], timeoutType: 'never', urgency: 'critical', silent: true })
    banners.add(n)
    const open = (): void => {
      banners.delete(n)
      if (join) void shell.openExternal(join.url)
      else showMain()
    }
    n.on('click', open)
    n.on('action', open)
    n.on('close', () => banners.delete(n))
    n.on('failed', (_, error) => {
      banners.delete(n)
      console.error('notification failed', error)
    })
    n.show()
  }

  setInterval(() => void tick(), TICK_MS)
  // Timers stall while asleep: catch up right after wake (the grace window keeps just-started events).
  powerMonitor.on('resume', () => void tick())
  void tick()
}
