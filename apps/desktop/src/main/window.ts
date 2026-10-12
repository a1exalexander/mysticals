import { join } from 'path'
import { BrowserWindow, Notification, shell, type NotificationConstructorOptions, type WebPreferences } from 'electron'

/** Every app window runs the renderer sandboxed, with only the preload bridge. */
export const webPreferences: WebPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
}

/** The theme's background (`--bg`), as last sent over themeSet: new windows start in it, so there is no flash. */
export const themeBg = { current: '#0b0b10' }

/** The renderer never navigates or opens windows; external http(s) links go to the system browser. */
export function lockDown(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** Loads the renderer bundle, on the `#hash` route when given. */
export function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

/** Sends `channel` to every open window (main, reminder screen, hidden sound window). */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

// Held until closed/clicked: a GC'd Notification drops its click/action handlers.
const banners = new Set<Notification>()

/** Shows a system notification; `onClick` runs on a click or one of its action buttons. */
export function showBanner(opts: NotificationConstructorOptions, onClick?: () => void): void {
  const n = new Notification(opts)
  banners.add(n)
  const click = (): void => {
    banners.delete(n)
    onClick?.()
  }
  n.on('click', click)
  n.on('action', click)
  n.on('close', () => banners.delete(n))
  // e.g. "UNErrorDomain error 1": notifications not allowed for this app in System Settings.
  n.on('failed', (_, error) => {
    banners.delete(n)
    console.error('notification failed', error)
  })
  n.show()
}
