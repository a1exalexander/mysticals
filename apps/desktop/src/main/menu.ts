import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '@shared/ipc'

const send = (cmd: MenuCommand) => (): void => BrowserWindow.getFocusedWindow()?.webContents.send(IPC.menu, cmd)

export function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'New Event', accelerator: 'CmdOrCtrl+N', click: send('new-event') }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Today', accelerator: 'CmdOrCtrl+T', click: send('today') },
        { type: 'separator' },
        { label: 'Day', accelerator: 'CmdOrCtrl+1', click: send('view-day') },
        { label: '3 Days', accelerator: 'CmdOrCtrl+2', click: send('view-3day') },
        { label: 'Week', accelerator: 'CmdOrCtrl+3', click: send('view-week') },
        { label: 'Month', accelerator: 'CmdOrCtrl+4', click: send('view-month') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
