import type { Locale, LocaleSetting } from '../i18n'
import type { TimeFormat, WeekStart } from '../logic/clock'
import type {
  Account,
  Calendar,
  CalEvent,
  CaldavAccountInput,
  DeleteScope,
  LogPage,
  LogQuery,
  NewEventInput,
  PartStat,
  Recurrence,
  TimeRange
} from './types'

/** API exposed to renderer as `window.api` (via preload contextBridge). */
export interface Api {
  accounts: {
    list(): Promise<Account[]>
    /** Opens system browser for Google OAuth; resolves with the new account. */
    addGoogle(): Promise<Account>
    addCaldav(input: CaldavAccountInput): Promise<Account>
    update(id: string, patch: { label?: string; color?: string }): Promise<Account>
    remove(id: string): Promise<void>
    /** Reconnects an account whose credentials were rejected (`authError`): a new CalDAV password, or Google sign-in again. */
    reauth(id: string, input?: { password: string }): Promise<Account>
  }
  calendars: {
    list(): Promise<Calendar[]>
    setVisible(accountId: string, calendarId: string, visible: boolean): Promise<void>
  }
  events: {
    /** Cached events of all calendars in range, hidden ones included (the renderer filters by `visible`). Each event keeps its accountId. */
    list(range: TimeRange): Promise<CalEvent[]>
    create(input: NewEventInput): Promise<CalEvent>
    update(event: CalEvent, scope?: DeleteScope): Promise<CalEvent>
    delete(event: CalEvent, scope?: DeleteScope): Promise<void>
    respond(event: CalEvent, status: Exclude<PartStat, 'needsAction'>): Promise<CalEvent>
    /** How the event's series repeats (null for a single event). Reads the provider, not the cache. */
    recurrence(event: CalEvent): Promise<Recurrence | null>
  }
  sync: {
    now(accountId?: string): Promise<void>
  }
  /** Fires when cached data of an account changed. Returns unsubscribe. */
  onChanged(cb: (accountId: string) => void): () => void
  /** Fires on native menu commands. Returns unsubscribe. */
  onMenu(cb: (cmd: MenuCommand) => void): () => void
  /** Desktop: Google sign-in finished in the browser and the account is being connected. Returns unsubscribe. */
  onSignIn?(cb: (stage: 'connecting') => void): () => void
}

/** Desktop self-update state (see apps/desktop/src/main/update.ts). */
export interface UpdateState {
  status: 'idle' | 'available' | 'downloading' | 'ready' | 'error'
  version?: string
  /** Download progress, 0..100. */
  progress?: number
  error?: string
}

/** Desktop-only API exposed as `window.update`; kept out of `Api` so the terminal daemon need not implement it. */
export interface UpdateApi {
  state(): Promise<UpdateState>
  check(): Promise<UpdateState>
  /** macOS: downloads the new version, swaps the app bundle and relaunches. Windows/Linux: opens the release page. */
  install(): Promise<void>
  /** Fires on every state change. Returns unsubscribe. */
  onUpdate(cb: (s: UpdateState) => void): () => void
}

/** Desktop-only Settings > Privacy toggle, exposed as `window.telemetry`. */
export interface TelemetryApi {
  enabled(): Promise<boolean>
  setEnabled(on: boolean): Promise<void>
}

/** Desktop-only Settings > Notifications: minutes before an event its reminder pops up (0 = off). Exposed as `window.reminders`. */
export interface ReminderApi {
  get(): Promise<number>
  set(min: number): Promise<void>
  /** Ids of the accounts whose reminders and invite/change banners are off. */
  muted(): Promise<string[]>
  setMuted(accountId: string, muted: boolean): Promise<void>
  /** Full-screen reminder for events with a Call link instead of a Banner; off by default. */
  fullscreen(): Promise<boolean>
  setFullscreen(on: boolean): Promise<void>
  /** A sound with each reminder (Banner chime, Full-screen reminder bell); on by default. */
  sound(): Promise<boolean>
  setSound(on: boolean): Promise<void>
  /** Plays the sound reminders make now (bell with the Full-screen reminder on, else chime), even with sound off; resolves once it has faded. */
  testSound(): Promise<void>
  /** Opens the Full-screen reminder with a test meeting; resolves once it is shown. */
  preview(): Promise<void>
}

/** One meeting on the full-screen reminder (ISO start/end, calendar colour, account label, its Call link). */
export interface ReminderMeeting {
  key: string
  title: string
  start: string
  end: string
  color: string
  account: string
  url: string
}

/** Desktop-only, in the full-screen reminder window (`#reminder` route): its meetings, and closing it. Exposed as `window.reminderScreen`. */
export interface ReminderScreenApi {
  meetings(): Promise<ReminderMeeting[]>
  /** Fires when meetings are added to or dropped from the screen. Returns unsubscribe. */
  onMeetings(cb: (list: ReminderMeeting[]) => void): () => void
  /** Its meetings are painted: main shows the window (it opens hidden). */
  ready(): Promise<void>
  /** Closes the screen; with one of its meetings' `url`, opens that call in the browser first. */
  close(url?: string): Promise<void>
}

/** UI language: the Settings choice, the language in use and what the OS asks for (shown next to "Automatic"). */
export interface LocaleState {
  setting: LocaleSetting
  locale: Locale
  system: Locale
}

/** Desktop-only Settings > Language, exposed as `window.locale`. */
export interface LocaleApi {
  get(): Promise<LocaleState>
  set(setting: LocaleSetting): Promise<LocaleState>
  /** Fires when the language changes. Returns unsubscribe. */
  onChange(cb: (s: LocaleState) => void): () => void
}

/** Clock: the Settings choices, what is in use and what Auto means here (from the OS region, shown next to "Auto"). */
export interface ClockState {
  timeFormat: TimeFormat
  weekStart: WeekStart
  hour12: boolean
  weekStartsOn: 0 | 1
  system: { hour12: boolean; weekStartsOn: 0 | 1 }
}

/** Desktop-only Settings > General time format and first day of the week, exposed as `window.clock`. */
export interface ClockApi {
  get(): Promise<ClockState>
  set(patch: { timeFormat?: TimeFormat; weekStart?: WeekStart }): Promise<ClockState>
  /** Fires when either changes. Returns unsubscribe. */
  onChange(cb: (s: ClockState) => void): () => void
}

/** Desktop-only: matches the native window (title bar, background) to the picked theme. Exposed as `window.appTheme`. */
export interface ThemeApi {
  set(scheme: 'dark' | 'light', bg: string): Promise<void>
}

/** Desktop-only Settings > Logs: what happened per account, kept 30 days. Exposed as `window.logs`. */
export interface LogApi {
  list(q: LogQuery): Promise<LogPage>
  /** Opens the folder with the daily log files. */
  openFolder(): Promise<void>
  /** Fires when entries are added. Returns unsubscribe. */
  onAppended(cb: () => void): () => void
}

export type MenuCommand = 'new-event' | 'today' | 'toggle-sidebar' | 'view-agenda' | 'view-day' | 'view-3day' | 'view-week' | 'view-month'

export const IPC = {
  accountsList: 'accounts:list',
  accountsAddGoogle: 'accounts:addGoogle',
  accountsAddCaldav: 'accounts:addCaldav',
  accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove',
  accountsReauth: 'accounts:reauth',
  calendarsList: 'calendars:list',
  calendarsSetVisible: 'calendars:setVisible',
  eventsList: 'events:list',
  eventsCreate: 'events:create',
  eventsUpdate: 'events:update',
  eventsDelete: 'events:delete',
  eventsRespond: 'events:respond',
  eventsRecurrence: 'events:recurrence',
  syncNow: 'sync:now',
  changed: 'changed',
  menu: 'menu',
  signIn: 'signin',
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  update: 'update',
  telemetryGet: 'telemetry:get',
  telemetrySet: 'telemetry:set',
  remindersGet: 'reminders:get',
  remindersSet: 'reminders:set',
  remindersMutedGet: 'reminders:muted-get',
  remindersMutedSet: 'reminders:muted-set',
  remindersFullscreenGet: 'reminders:fullscreen-get',
  remindersFullscreenSet: 'reminders:fullscreen-set',
  remindersSoundGet: 'reminders:sound-get',
  remindersSoundSet: 'reminders:sound-set',
  remindersSoundTest: 'reminders:sound-test',
  remindersPreview: 'reminders:preview',
  reminderScreenMeetings: 'reminder-screen:meetings',
  reminderScreenReady: 'reminder-screen:ready',
  reminderScreenClose: 'reminder-screen:close',
  themeSet: 'theme:set',
  localeGet: 'locale:get',
  localeSet: 'locale:set',
  locale: 'locale',
  clockGet: 'clock:get',
  clockSet: 'clock:set',
  clock: 'clock',
  logsList: 'logs:list',
  logsOpen: 'logs:open',
  logsAppended: 'logs:appended'
} as const
