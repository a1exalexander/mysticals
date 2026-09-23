import { ipcMain } from 'electron'
import type { Api } from '@shared/ipc'
import { IPC } from '@shared/ipc'

type Impl = Omit<Api, 'onChanged' | 'onMenu'>

/** Maps IPC channels to an Api implementation. Validation belongs inside impl (unit 5). */
export function registerApi(api: Impl): void {
  const h = (ch: string, fn: (...a: never[]) => unknown): void => {
    ipcMain.removeHandler(ch)
    ipcMain.handle(ch, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
  }
  h(IPC.accountsList, api.accounts.list)
  h(IPC.accountsAddGoogle, api.accounts.addGoogle)
  h(IPC.accountsAddCaldav, api.accounts.addCaldav)
  h(IPC.accountsUpdate, api.accounts.update)
  h(IPC.accountsRemove, api.accounts.remove)
  h(IPC.calendarsList, api.calendars.list)
  h(IPC.calendarsSetVisible, api.calendars.setVisible)
  h(IPC.eventsList, api.events.list)
  h(IPC.eventsCreate, api.events.create)
  h(IPC.eventsUpdate, api.events.update)
  h(IPC.eventsDelete, api.events.delete)
  h(IPC.eventsRespond, api.events.respond)
  h(IPC.syncNow, api.sync.now)
}
