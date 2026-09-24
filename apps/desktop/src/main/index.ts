import { join } from 'path'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { app, BrowserWindow, Menu, nativeTheme, Notification, safeStorage, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { createMockApi } from '@mysticals/core/mock/mockApi'
import { createApi } from '@mysticals/core/api'
import { AccountStore, type SecretCrypto } from '@mysticals/core/accounts/store'
import { SyncEngine } from '@mysticals/core/sync/engine'
import { noteText, type Note } from '@mysticals/core/sync/notify'
import { createCaldavProvider, verifyCaldav } from '@mysticals/core/providers/caldav'
import { createGoogleProvider, googleSignIn, setClientConfig } from '@mysticals/core/providers/google'
import { registerApi } from './ipc/register'
import { buildMenu } from './menu'
import { startUpdater } from './update'
import { electronTriggers } from './sync/electronTriggers'

const MOCK = process.env.MYSTICALS_MOCK === '1'
// Mock runs (e2e) get a throwaway profile so localStorage (collapsed accounts, theme) never leaks between runs.
if (MOCK) app.setPath('userData', mkdtempSync(join(tmpdir(), 'mysticals-mock-')))

function broadcast(accountId: string): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.changed, accountId)
}

// Held until closed/clicked: a GC'd Notification drops its click handler.
const banners = new Set<Notification>()

/** macOS banners for invites/changes; events in hidden calendars stay silent. */
function notify(store: AccountStore, accountId: string, notes: Note[]): void {
  const account = store.list().find((a) => a.id === accountId)
  if (!account || !Notification.isSupported()) return
  const hidden = new Set(store.hiddenCalendars(accountId))
  const shown = notes.filter((n) => !hidden.has(n.event.calendarId))
  for (const { title, body } of noteText(shown, account.label)) {
    const n = new Notification({ title, body })
    banners.add(n)
    n.on('close', () => banners.delete(n))
    // e.g. "UNErrorDomain error 1": notifications not allowed for this app in System Settings.
    n.on('failed', (_, error) => {
      banners.delete(n)
      console.error('notification failed', error)
    })
    n.on('click', () => {
      banners.delete(n)
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return createWindow()
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    n.show()
  }
}

/** Credentials are encrypted with the macOS Keychain-backed Electron safeStorage. */
const safeStorageCrypto: SecretCrypto = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable; refusing to store credentials')
    return safeStorage.encryptString(plain)
  },
  decrypt: (data) => safeStorage.decryptString(data)
}

const stateFile = (): string => join(app.getPath('userData'), 'window-state.json')

function loadSize(): { width: number; height: number } {
  try {
    const { width, height } = JSON.parse(readFileSync(stateFile(), 'utf8'))
    if (Number.isInteger(width) && Number.isInteger(height)) return { width, height }
  } catch {
    // first launch or unreadable file
  }
  return { width: 1200, height: 800 }
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...loadSize(),
    minWidth: 800,
    minHeight: 500,
    show: false,
    titleBarStyle: 'hiddenInset',
    // Solid dark window (no vibrancy); matches --bg so there is no flash before first paint.
    backgroundColor: '#0b0b10',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())

  // The renderer never navigates or opens windows; external http(s) links go to the system browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Mock runs (e2e) must not touch the real window state.
  if (!MOCK)
    win.on('close', () => {
      const { width, height } = win.getNormalBounds()
      try {
        writeFileSync(stateFile(), JSON.stringify({ width, height }))
      } catch (e) {
        console.error('failed to save window state', e)
      }
    })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  // Packaged builds get the icon from electron-builder; in dev the dock would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  Menu.setApplicationMenu(buildMenu())
  if (MOCK) {
    registerApi(createMockApi(broadcast))
  } else {
    setClientConfig({
      clientId: import.meta.env.MYSTICALS_GOOGLE_CLIENT_ID,
      clientSecret: import.meta.env.MYSTICALS_GOOGLE_CLIENT_SECRET
    })
    const factories = { caldav: createCaldavProvider, google: createGoogleProvider }
    const store = new AccountStore(app.getPath('userData'), factories, safeStorageCrypto)
    const sync = new SyncEngine(store, broadcast, {
      triggers: electronTriggers,
      onEvents: (id, notes) => notify(store, id, notes),
      onSyncing: broadcast // renderer re-reads accounts.list for the `syncing` flag
    })
    try {
      const signIn = (): ReturnType<typeof googleSignIn> => googleSignIn((url) => shell.openExternal(url))
      registerApi(createApi(store, sync, { verifyCaldav, googleSignIn: signIn, onChanged: broadcast }))
      sync.start()
    } catch (e) {
      console.error('backend not ready', e)
    }
  }
  startUpdater()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
