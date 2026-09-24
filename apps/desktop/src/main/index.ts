import { join } from 'path'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { app, BrowserWindow, dialog, Menu, nativeTheme, Notification, safeStorage, shell } from 'electron'
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
const MAC = process.platform === 'darwin'
// Mock runs (e2e) get a throwaway profile so localStorage (collapsed accounts, theme) never leaks between runs.
if (MOCK) app.setPath('userData', mkdtempSync(join(tmpdir(), 'mysticals-mock-')))
// One copy per profile (the lock is keyed on userData, so e2e temp profiles never collide):
// two copies would each rewrite accounts.json from their own in-memory list.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
// Only once the backend is up: during startup (or the load-error box) there is nothing to show yet.
let started = false
app.on('second-instance', () => started && showMain())

/** Brings the main window forward, or opens one. */
function showMain(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function broadcast(accountId: string): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.changed, accountId)
}

// Held until closed/clicked: a GC'd Notification drops its click handler.
const banners = new Set<Notification>()

/** System banners for invites/changes; events in hidden calendars stay silent. */
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
      showMain()
    })
    n.show()
  }
}

/**
 * Credentials are encrypted with Electron safeStorage: Keychain on macOS, DPAPI on Windows,
 * libsecret/kwallet on Linux. Linux without a keyring falls back to a hardcoded key ('basic_text'), so refuse it.
 */
const secureStorageReady = (): boolean =>
  safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')

const NO_SECURE_STORAGE =
  'Secure storage is unavailable; refusing to store credentials' +
  (process.platform === 'linux'
    ? '. Install and unlock a Secret Service keyring (GNOME Keyring or KWallet), then restart Mysticals.'
    : '')

const safeStorageCrypto: SecretCrypto = {
  encrypt(plain) {
    if (!secureStorageReady()) throw new Error(NO_SECURE_STORAGE)
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
    // Inset traffic lights on macOS; Windows/Linux keep the native frame.
    ...(MAC ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
    // Solid dark window (no vibrancy); matches --bg so there is no flash before first paint.
    backgroundColor: '#0b0b10',
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
  if (!primary) return
  // Must match appId in electron-builder.yml, or Windows toasts show the wrong name/icon.
  if (process.platform === 'win32') app.setAppUserModelId('com.a1exalexander.mysticals')
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
    let store: AccountStore
    try {
      store = new AccountStore(app.getPath('userData'), factories, safeStorageCrypto)
    } catch (e) {
      // Unreadable accounts.json: say so and quit rather than open a window with no backend. The file is left as is.
      const file = join(app.getPath('userData'), 'accounts.json')
      console.error('failed to load accounts', file, e)
      dialog.showErrorBox(
        'Mysticals could not load your accounts',
        `${file} could not be read:\n${e instanceof Error ? e.message : String(e)}\n\nThe file was not changed. Fix it or move it aside (Mysticals then starts with no accounts), and reopen the app.`
      )
      return app.quit()
    }
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
  started = true
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => !MAC && app.quit())
