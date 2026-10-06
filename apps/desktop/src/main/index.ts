import { join } from 'path'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, shell, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc'
import { createMockApi } from '@mysticals/core/mock/mockApi'
import { createApi } from '@mysticals/core/api'
import { AccountStore, type SecretCrypto } from '@mysticals/core/accounts/store'
import { SyncEngine } from '@mysticals/core/sync/engine'
import { noteText, type Note } from '@mysticals/core/sync/notify'
import { t } from '@mysticals/core/i18n'
import type { AccountAdded } from '@mysticals/core/telemetry'
import { createCaldavProvider, verifyCaldav } from '@mysticals/core/providers/caldav'
import { createGoogleProvider, googleSignIn, setClientConfig } from '@mysticals/core/providers/google'
import { registerApi } from './ipc/register'
import { currentLocale, startLocale } from './locale'
import { startUpdater } from './update'
import { startDesktopTelemetry } from './telemetry'
import { startReminders } from './reminders'
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
// mysticals:// links (the Google sign-in page opens one) just bring the app forward. Windows/Linux deliver them as a
// second instance (above); macOS as open-url, which must be hooked before ready.
const PROTOCOL = 'mysticals'
app.on('open-url', (e) => {
  e.preventDefault()
  if (started) showMain()
})

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
  for (const { title, body } of noteText(shown, account.label, new Date(), currentLocale())) {
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

const noSecureStorage = (): string =>
  t(currentLocale(), process.platform === 'linux' ? 'error.noSecureStorageLinux' : 'error.noSecureStorage')

const safeStorageCrypto: SecretCrypto = {
  encrypt(plain) {
    if (!secureStorageReady()) throw new Error(noSecureStorage())
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
    // Sidebar (240) + a main pane wide enough for the toolbar on one row and a readable week grid.
    minWidth: 960,
    minHeight: 600,
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

  // Right-click: copy selected text and links, the usual edit actions in fields.
  win.webContents.on('context-menu', (_e, p) => {
    const web = /^https?:\/\//i.test(p.linkURL)
    const items: MenuItemConstructorOptions[] = [
      ...(web
        ? [
            { label: t(currentLocale(), 'menu.openLink'), click: () => void shell.openExternal(p.linkURL) },
            { label: t(currentLocale(), 'menu.copyLink'), click: () => clipboard.writeText(p.linkURL) },
            { type: 'separator' as const }
          ]
        : []),
      ...(p.isEditable
        ? [
            { role: 'cut' as const, label: t(currentLocale(), 'menu.cut'), enabled: p.editFlags.canCut },
            { role: 'copy' as const, label: t(currentLocale(), 'menu.copy'), enabled: p.editFlags.canCopy },
            { role: 'paste' as const, label: t(currentLocale(), 'menu.paste'), enabled: p.editFlags.canPaste },
            { type: 'separator' as const },
            { role: 'selectAll' as const, label: t(currentLocale(), 'menu.selectAll') }
          ]
        : p.selectionText.trim()
          ? [{ role: 'copy' as const, label: t(currentLocale(), 'menu.copy') }]
          : [])
    ]
    while (items.at(-1)?.type === 'separator') items.pop()
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
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
  // Settings > Themes: light palettes get a light native frame; the window bg follows --bg (no flash on resize).
  ipcMain.handle(IPC.themeSet, (e, scheme: unknown, bg: unknown) => {
    nativeTheme.themeSource = scheme === 'light' ? 'light' : 'dark'
    if (typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg)) BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(bg)
  })
  // Packaged builds get the icon from electron-builder; in dev the dock would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  startLocale()
  // Dev runs would register the bare Electron binary; electron-builder's `protocols` covers installed builds too.
  if (app.isPackaged && !MOCK) app.setAsDefaultProtocolClient(PROTOCOL)
  const track = startDesktopTelemetry()
  if (MOCK) {
    const api = createMockApi(broadcast)
    registerApi(api)
    startReminders(api, showMain)
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
        t(currentLocale(), 'error.accountsTitle'),
        t(currentLocale(), 'error.accountsBody', { file, error: e instanceof Error ? e.message : String(e) })
      )
      return app.quit()
    }
    const sync = new SyncEngine(store, broadcast, {
      triggers: electronTriggers,
      onEvents: (id, notes) => notify(store, id, notes),
      onSyncing: broadcast // renderer re-reads accounts.list for the `syncing` flag
    })
    try {
      // The user finishes sign-in in the browser: bring Mysticals back right away so they see the account connect
      // (the sheet shows "connecting" while the code is exchanged); the success page also opens mysticals://.
      const signIn = (): ReturnType<typeof googleSignIn> =>
        googleSignIn((url) => shell.openExternal(url), {
          returnUrl: app.isPackaged ? `${PROTOCOL}://signed-in` : undefined,
          onCode: () => {
            for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.signIn, 'connecting')
            showMain()
            if (MAC) app.focus({ steal: true })
          }
        })
      const onAccountAdded = (info: AccountAdded): void => track?.('account_added', info)
      const api = createApi(store, sync, { verifyCaldav, googleSignIn: signIn, onChanged: broadcast, onAccountAdded })
      registerApi(api)
      startReminders(api, showMain)
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
