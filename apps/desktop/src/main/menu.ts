import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '@shared/ipc'
import { t, type Locale } from '@mysticals/core/i18n'

const send = (cmd: MenuCommand) => (): void => BrowserWindow.getFocusedWindow()?.webContents.send(IPC.menu, cmd)

/** The menu bar in `locale`. Role items get explicit labels: Electron leaves them English on Windows/Linux. */
export function buildMenu(locale: Locale = 'en'): Menu {
  const mac = process.platform === 'darwin'
  const l = (key: Parameters<typeof t>[1]): string => t(locale, key)
  const template: MenuItemConstructorOptions[] = [
    // The app menu is a macOS concept; elsewhere Quit lives in File.
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    {
      label: l('menu.file'),
      submenu: [
        { label: l('menu.newEvent'), accelerator: 'CmdOrCtrl+N', click: send('new-event') },
        { type: 'separator' },
        mac ? { role: 'close', label: l('menu.close') } : { role: 'quit', label: l('menu.quit') }
      ]
    },
    {
      label: l('menu.edit'),
      submenu: [
        { role: 'undo', label: l('menu.undo') },
        { role: 'redo', label: l('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: l('menu.cut') },
        { role: 'copy', label: l('menu.copy') },
        { role: 'paste', label: l('menu.paste') },
        { role: 'selectAll', label: l('menu.selectAll') }
      ]
    },
    {
      label: l('menu.view'),
      submenu: [
        { label: l('menu.today'), accelerator: 'CmdOrCtrl+T', click: send('today') },
        // The renderer handles the key itself (so it also works with the menu bar hidden); the menu only shows it.
        { label: l('menu.toggleSidebar'), accelerator: 'CmdOrCtrl+\\', registerAccelerator: false, click: send('toggle-sidebar') },
        { type: 'separator' },
        { label: l('view.agenda'), accelerator: 'CmdOrCtrl+0', click: send('view-agenda') },
        { label: l('view.day'), accelerator: 'CmdOrCtrl+1', click: send('view-day') },
        { label: l('view.3day'), accelerator: 'CmdOrCtrl+2', click: send('view-3day') },
        { label: l('view.week'), accelerator: 'CmdOrCtrl+3', click: send('view-week') },
        { label: l('view.month'), accelerator: 'CmdOrCtrl+4', click: send('view-month') },
        { type: 'separator' },
        { role: 'reload', label: l('menu.reload') },
        { role: 'toggleDevTools', label: l('menu.devTools') },
        { role: 'togglefullscreen', label: l('menu.fullScreen') }
      ]
    },
    {
      role: 'window',
      label: l('menu.window'),
      submenu: [
        { role: 'minimize', label: l('menu.minimize') },
        { role: 'zoom', label: l('menu.zoom') },
        ...(mac ? [{ type: 'separator' } as const, { role: 'front', label: l('menu.front') } as const] : [{ role: 'close', label: l('menu.close') } as const])
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}
