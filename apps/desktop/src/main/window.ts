import { join } from 'path'
import { shell, type BrowserWindow, type WebPreferences } from 'electron'

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
