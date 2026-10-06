import { ipcMain, Notification, powerMonitor, shell } from 'electron'
import { IPC, type Api } from '@shared/ipc'
import { DEFAULT_REMINDER_MIN, dueReminders, isReminderMin, reminderKey, reminderText } from '@mysticals/core/logic/reminders'
import { visibleEvents } from '@mysticals/core/logic/visible'
import { currentLocale } from './locale'
import { readPrefs, writePrefs } from './prefs'

const TICK_MS = 20_000

/** Settings > Notifications: minutes before an event, 0 = off. */
export const reminderMin = (): number => {
  const v = readPrefs().reminderMin
  return isReminderMin(v) ? v : DEFAULT_REMINDER_MIN
}

// Held until closed/clicked: a GC'd Notification drops its click/action handlers.
const banners = new Set<Notification>()

/**
 * Pops a system notification `reminderMin` minutes before each upcoming event while the app runs. Clicking it (or its
 * macOS "Join" button) opens the event's call link; without one it brings the app forward. Polls the cached events,
 * so synced changes and moved events need no re-arming. Hidden calendars, declined and all-day events stay silent.
 */
export function startReminders(api: Pick<Api, 'events' | 'calendars'>, showMain: () => void): void {
  ipcMain.handle(IPC.remindersGet, reminderMin)
  ipcMain.handle(IPC.remindersSet, (_e, min: unknown) => {
    if (!isReminderMin(min)) throw new Error(`Invalid reminder: ${String(min)}`)
    writePrefs({ reminderMin: min })
    void tick()
  })

  const sent = new Map<string, number>() // reminder key → event start (ms), to forget old ones
  let busy = false
  const tick = async (): Promise<void> => {
    const lead = reminderMin()
    if (busy || !lead || !Notification.isSupported()) return
    busy = true
    try {
      const now = new Date()
      const range = { start: new Date(now.getTime() - 60 * 60_000).toISOString(), end: new Date(now.getTime() + (lead + 1) * 60_000).toISOString() }
      const [events, calendars] = await Promise.all([api.events.list(range), api.calendars.list()])
      for (const [k, start] of sent) if (start < now.getTime() - 60 * 60_000) sent.delete(k)
      for (const e of dueReminders(visibleEvents(events, calendars), now, lead, new Set(sent.keys()))) {
        sent.set(reminderKey(e), new Date(e.start).getTime())
        show(reminderText(e, now, currentLocale()))
      }
    } catch (e) {
      console.error('reminders failed', e)
    } finally {
      busy = false
    }
  }

  const show = ({ title, body, join }: ReturnType<typeof reminderText>): void => {
    const n = new Notification({ title, body, actions: join ? [{ type: 'button', text: join.label }] : [] })
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
