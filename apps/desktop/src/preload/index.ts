import { contextBridge, ipcRenderer } from 'electron'
import type { Api, MenuCommand, TelemetryApi, UpdateApi, UpdateState } from '@shared/ipc'
import { IPC } from '@shared/ipc'

const call =
  (ch: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(ch, ...args)

const on = <T>(ch: string, cb: (v: T) => void): (() => void) => {
  const l = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(ch, l)
  return () => ipcRenderer.removeListener(ch, l)
}

const api: Api = {
  accounts: {
    list: call(IPC.accountsList),
    addGoogle: call(IPC.accountsAddGoogle),
    addCaldav: call(IPC.accountsAddCaldav),
    update: call(IPC.accountsUpdate),
    remove: call(IPC.accountsRemove)
  },
  calendars: { list: call(IPC.calendarsList), setVisible: call(IPC.calendarsSetVisible) },
  events: {
    list: call(IPC.eventsList),
    create: call(IPC.eventsCreate),
    update: call(IPC.eventsUpdate),
    delete: call(IPC.eventsDelete),
    respond: call(IPC.eventsRespond)
  },
  sync: { now: call(IPC.syncNow) },
  onChanged: (cb) => on<string>(IPC.changed, cb),
  onMenu: (cb) => on<MenuCommand>(IPC.menu, cb),
  onSignIn: (cb) => on<'connecting'>(IPC.signIn, cb)
} as Api

contextBridge.exposeInMainWorld('api', api)

const update: UpdateApi = {
  state: call(IPC.updateState),
  check: call(IPC.updateCheck),
  install: call(IPC.updateInstall),
  onUpdate: (cb) => on<UpdateState>(IPC.update, cb)
} as UpdateApi

contextBridge.exposeInMainWorld('update', update)

const telemetry: TelemetryApi = { enabled: call(IPC.telemetryGet), setEnabled: call(IPC.telemetrySet) } as TelemetryApi
contextBridge.exposeInMainWorld('telemetry', telemetry)

// Lets CSS drop the macOS traffic-light inset on Windows/Linux.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.platform = process.platform
})
