import type {
  Account,
  Calendar,
  CalEvent,
  CaldavAccountInput,
  NewEventInput,
  PartStat,
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
  }
  calendars: {
    list(): Promise<Calendar[]>
    setVisible(accountId: string, calendarId: string, visible: boolean): Promise<void>
  }
  events: {
    /** Cached events of all visible calendars in range. Each event keeps its accountId. */
    list(range: TimeRange): Promise<CalEvent[]>
    create(input: NewEventInput): Promise<CalEvent>
    update(event: CalEvent): Promise<CalEvent>
    delete(event: CalEvent): Promise<void>
    respond(event: CalEvent, status: Exclude<PartStat, 'needsAction'>): Promise<CalEvent>
  }
  sync: {
    now(accountId?: string): Promise<void>
  }
  /** Fires when cached data of an account changed. Returns unsubscribe. */
  onChanged(cb: (accountId: string) => void): () => void
  /** Fires on native menu commands. Returns unsubscribe. */
  onMenu(cb: (cmd: MenuCommand) => void): () => void
}

export type MenuCommand = 'new-event' | 'today' | 'view-day' | 'view-3day' | 'view-week' | 'view-month'

export const IPC = {
  accountsList: 'accounts:list',
  accountsAddGoogle: 'accounts:addGoogle',
  accountsAddCaldav: 'accounts:addCaldav',
  accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove',
  calendarsList: 'calendars:list',
  calendarsSetVisible: 'calendars:setVisible',
  eventsList: 'events:list',
  eventsCreate: 'events:create',
  eventsUpdate: 'events:update',
  eventsDelete: 'events:delete',
  eventsRespond: 'events:respond',
  syncNow: 'sync:now',
  changed: 'changed',
  menu: 'menu'
} as const
