import { join } from 'path'
import { app, Notification, powerMonitor, shell } from 'electron'
import { Cause, Effect, FileSystem, Schedule, Schema, Semaphore } from 'effect'
import { IPC, type ReminderMeeting } from '@shared/ipc'
import type { Account, Calendar, CalEvent, LogEntry } from '@shared/types'
import type { CoreApiEffect } from '@mysticals/core/api'
import { readJson, writeAtomic } from '@mysticals/core/accounts/store'
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
import { AnyArgs, handle } from './ipc/register'
import { showBanner } from './window'

const TICK = '20 seconds'

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

/**
 * Pops a system notification `reminderMin` minutes before each upcoming event while the app runs. Clicking it (or its
 * macOS "Join" button) opens the event's call link; without one it brings the app forward. With the Full-screen reminder
 * on, events with a Call link go on that screen instead, all due ones together. Polls the cached events,
 * so synced changes and moved events need no re-arming. Muted accounts, hidden calendars, declined and all-day events stay
 * silent. Ticks stop when the scope closes.
 */
export const startReminders = (api: Pick<CoreApiEffect, 'events' | 'calendars' | 'accounts'>, showMain: () => void, log?: (e: LogEntry) => void) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope

    // reminder key → event start (ms), to forget old ones. On disk so a restart inside the reminder window stays quiet.
    const sentFile = join(app.getPath('userData'), 'reminded.json')
    const sent = loadReminded(yield* readJson<unknown>(sentFile, undefined).pipe(Effect.orElseSucceed(() => undefined)), Date.now())
    const saveSent = writeAtomic(sentFile, JSON.stringify(Object.fromEntries(sent))).pipe(
      Effect.catch((e) => Effect.sync(() => console.error('saving reminded keys failed', e)))
    )
    // Meetings on the open full-screen reminder; empty while it is closed.
    let onScreen: CalEvent[] = []
    startReminderScreen(() => (onScreen = []))

    const show = ({ title, body, join }: ReturnType<typeof reminderText>): void =>
      // Stays until dismissed on Windows/Linux (critical: GNOME ignores timeouts); macOS takes it from Info.plist. Silent: playSound() rings instead.
      showBanner({ title, body, actions: join ? [{ type: 'button', text: join.label }] : [], timeoutType: 'never', urgency: 'critical', silent: true }, () => {
        if (join) void shell.openExternal(join.url)
        else showMain()
      })

    const tickOnce = Effect.gen(function* () {
      const lead = reminderMin()
      // An open screen still needs ticks to drop ended or cancelled meetings.
      if (!lead && !onScreen.length) return
      const now = new Date()
      const range = { start: new Date(now.getTime() - REMINDED_KEEP_MS).toISOString(), end: new Date(now.getTime() + (lead + 1) * 60_000).toISOString() }
      const [events, calendars, accounts] = yield* Effect.all([api.events.list(range), api.calendars.list(), api.accounts.list()], { concurrency: 'unbounded' })
      const changed = pruneReminded(sent, now.getTime())
      const muted = mutedAccounts()
      const shown = visibleEvents(events, calendars).filter((e) => !muted.has(e.accountId))
      const due = dueReminders(shown, now, lead, new Set(sent.keys()))
      // Reminded once shown: every meeting on a dismissed screen counts too.
      for (const e of due) sent.set(reminderKey(e), new Date(e.start).getTime())
      if (due.length || changed) yield* saveSent
      // One synchronous step from here on: a dismiss in between would be undone.
      yield* Effect.sync(() => {
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
        onScreen = next
        const list = next.flatMap((e) => {
          const url = eventMeetingUrl(e)
          return url ? [meeting(e, url, calendars, accounts)] : []
        })
        void showReminderScreen(list)
      })
    }).pipe(
      Effect.catchCause((cause) => Effect.sync(() => console.error('reminders failed', Cause.squash(cause)))),
      Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem)
    )

    // Ticks never overlap; one asked for while another runs (a Settings change, wake) runs right after it, once.
    const lock = yield* Semaphore.make(1)
    let queued = false
    const tick = Effect.suspend(() => {
      if (queued) return Effect.void
      queued = true
      return Semaphore.withPermit(
        lock,
        Effect.suspend(() => {
          queued = false
          return tickOnce
        })
      )
    })
    const tickSoon = (): void => void Effect.runFork(Effect.forkIn(tick, scope))

    yield* handle(IPC.remindersGet, AnyArgs, () => Effect.sync(reminderMin))
    yield* handle(
      IPC.remindersSet,
      Schema.Tuple([Schema.declare(isReminderMin)]),
      ([min]) => writePrefs({ reminderMin: min }).pipe(Effect.andThen(Effect.sync(tickSoon))),
      ([min]) => `Invalid reminder: ${String(min)}`
    )
    yield* handle(IPC.remindersMutedGet, AnyArgs, () => Effect.sync(() => [...mutedAccounts()]))
    yield* handle(
      IPC.remindersMutedSet,
      Schema.Tuple([Schema.String, Schema.Boolean]),
      ([id, muted]) => {
        const off = mutedAccounts()
        if (muted) off.add(id)
        else off.delete(id)
        return writePrefs({ notifyOff: [...off] })
      },
      () => 'Invalid account mute'
    )
    yield* handle(IPC.remindersFullscreenGet, AnyArgs, () => Effect.sync(fullscreenReminder))
    yield* handle(
      IPC.remindersFullscreenSet,
      Schema.Tuple([Schema.Boolean]),
      ([on]) =>
        writePrefs({ fullscreenReminder: on }).pipe(
          Effect.andThen(
            Effect.sync(() => {
              keepSpareScreen(on)
              tickSoon()
            })
          )
        ),
      () => 'Invalid full-screen reminder'
    )
    yield* handle(IPC.remindersSoundGet, AnyArgs, () => Effect.sync(reminderSound))
    yield* handle(IPC.remindersSoundSet, Schema.Tuple([Schema.Boolean]), ([on]) => writePrefs({ reminderSound: on }), () => 'Invalid reminder sound')
    yield* handle(IPC.remindersSoundTest, AnyArgs, () => Effect.promise(() => playSound(fullscreenReminder() ? 'bell' : 'chime', true)))
    // Built here, not taken from the renderer: Join opens the meeting's url.
    yield* handle(IPC.remindersPreview, AnyArgs, () =>
      Effect.promise(() => {
        const start = Date.now() + Math.max(reminderMin(), 1) * 60_000
        void playSound('bell')
        return showReminderScreen([
          { key: 'preview', title: t(currentLocale(), 'reminder.preview'), start: new Date(start).toISOString(), end: new Date(start + 30 * 60_000).toISOString(), color: '', account: 'Mysticals', url: 'https://meet.google.com/' }
        ])
      })
    )

    yield* Effect.forkScoped(Effect.repeat(tick, Schedule.spaced(TICK)))
    // Timers stall while asleep: catch up right after wake (the grace window keeps just-started events).
    yield* Effect.acquireRelease(Effect.sync(() => powerMonitor.on('resume', tickSoon)), () => Effect.sync(() => powerMonitor.off('resume', tickSoon)))
  })
