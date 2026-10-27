import { ipcMain } from 'electron'
import type { Api } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import { wireError } from '@mysticals/core/errors'

type Impl = Omit<Api, 'onChanged' | 'onMenu' | 'onSignIn'>

/** Maps IPC channels to an Api implementation. Validation belongs inside impl (unit 5). */
export function registerApi(api: Impl): void {
  const h = (ch: string, fn: (...a: never[]) => unknown): void => {
    ipcMain.removeHandler(ch)
    // Electron keeps only an error's message: a core AppError rides in it with its key, for the renderer to translate.
    ipcMain.handle(ch, async (_e, ...args) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args)
      } catch (e) {
        throw wireError(e)
      }
    })
  }
  h(IPC.accountsList, api.accounts.list)
  h(IPC.accountsAddGoogle, api.accounts.addGoogle)
  h(IPC.accountsAddCaldav, api.accounts.addCaldav)
  h(IPC.accountsUpdate, api.accounts.update)
  h(IPC.accountsRemove, api.accounts.remove)
  h(IPC.accountsReauth, api.accounts.reauth)
  h(IPC.calendarsList, api.calendars.list)
  h(IPC.calendarsSetVisible, api.calendars.setVisible)
  h(IPC.eventsList, api.events.list)
  h(IPC.eventsCreate, api.events.create)
  h(IPC.eventsUpdate, api.events.update)
  h(IPC.eventsDelete, api.events.delete)
  h(IPC.eventsRespond, api.events.respond)
  h(IPC.eventsSetColor, api.events.setColor)
  h(IPC.eventsRecurrence, api.events.recurrence)
  h(IPC.syncNow, api.sync.now)
}
