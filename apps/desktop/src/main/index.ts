import { join } from 'path'
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, shell, type MenuItemConstructorOptions } from 'electron'
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { IPC } from '@shared/ipc'
import { createMockApi } from '@mysticals/core/mock/mockApi'
import { createApi } from '@mysticals/core/api'
import { AccountStore, SecretCrypto, type AccountStoreShape } from '@mysticals/core/accounts/store'
import { SyncEngine, type SyncResult } from '@mysticals/core/sync/engine'
import { remoteChanges, snap } from '@mysticals/core/logic/activity'
import type { LogEntry } from '@shared/types'
import { noteText, type Note } from '@mysticals/core/sync/notify'
import { t } from '@mysticals/core/i18n'
import { fail, messageOf } from '@mysticals/core/errors'
import type { AccountAdded, Track } from '@mysticals/core/telemetry'
import { createCaldavProvider, verifyCaldav } from '@mysticals/core/providers/caldav'
import { createGoogleProvider, googleSignIn, setClientConfig } from '@mysticals/core/providers/google'
import { registerApi, registerApiError } from './ipc/register'
import { loadPrefs } from './prefs'
import { currentLocale, startLocale } from './locale'
import { hour12, startClock } from './clock'
import { startUpdater } from './update'
import { startDesktopTelemetry } from './telemetry'
import { mutedAccounts, startReminders, warmReminders } from './reminders'
import { createActivityLog, registerActivityLog, type ActivityLog } from './activityLog'
import { electronTriggers } from './sync/electronTriggers'
import { broadcast, E2E, loadRenderer, lockDown, showBanner, showWindow, themeBg, webPreferences } from './window'

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

// Not getAllWindows()[0]: the full-screen reminder is a window too.
let mainWin: BrowserWindow | null = null

/** Brings the main window forward, or opens one. */
function showMain(): void {
  const win = mainWin
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  showWindow(win)
  if (!E2E) win.focus()
}

const changed = (accountId: string): void => broadcast(IPC.changed, accountId)

/** System banners for invites/changes; muted accounts and events in hidden calendars stay silent. Each note is logged. */
const notify = (store: AccountStoreShape, log: ActivityLog, accountId: string, notes: Note[]) =>
  Effect.gen(function* () {
    const account = (yield* store.list()).find((a) => a.id === accountId)
    if (!account) return
    const muted = mutedAccounts().has(accountId)
    const supported = Notification.isSupported()
    const hidden = new Set(yield* store.hiddenCalendars(accountId))
    const at = new Date().toISOString()
    for (const n of notes) {
      const reason = muted ? 'muted' : hidden.has(n.event.calendarId) ? 'hidden calendar' : !supported ? 'unsupported' : undefined
      log.append({ at, accountId, email: account.email, kind: 'notify', ok: true, event: snap(n.event), detail: { note: n.kind, shown: !reason, ...(reason ? { reason } : {}) } })
    }
    if (!supported || muted) return
    const shown = notes.filter((n) => !hidden.has(n.event.calendarId))
    for (const { title, body } of noteText(shown, account.label, new Date(), currentLocale(), hour12())) showBanner({ title, body }, showMain)
  }).pipe(Effect.catch((e) => Effect.sync(() => console.error('notify failed', e))))

/**
 * A finished sync in the activity log: failures always; successes when they brought changes, were the first sync or
 * ended an error (a quiet pass every 2 minutes would bury the rest). Each remote change gets its own entry.
 */
const logSync = (store: AccountStoreShape, log: ActivityLog, accountId: string, r: SyncResult) =>
  Effect.gen(function* () {
    const account = yield* store.get(accountId)
    const base = { at: new Date().toISOString(), accountId, email: account?.email ?? '' }
    if (!r.ok) return log.append({ ...base, kind: 'sync.fail', ok: false, error: r.error, detail: { auth: r.auth } })
    const first = !r.prev?.syncedAt
    const changes = first ? [] : remoteChanges(r.prev!, r.next)
    if (!first && !changes.length && !account?.error) return
    const count = (k: LogEntry['kind']): number => changes.filter((c) => c.kind === k).length
    log.append({
      ...base,
      kind: 'sync',
      ok: true,
      detail: {
        calendars: r.next.calendars.length,
        events: r.next.events.length,
        ...(first ? { first: true } : { added: count('remote.add'), changed: count('remote.change'), removed: count('remote.remove') }),
        ...(account?.error ? { recovered: account.error } : {})
      }
    })
    for (const c of changes) log.append({ ...base, ok: true, ...c })
  })

/** Tells open windows (Settings > Logs) to re-read, at most twice a second: a sync can append hundreds of entries. */
let logTimer: ReturnType<typeof setTimeout> | undefined
function logsAppended(): void {
  logTimer ??= setTimeout(() => {
    logTimer = undefined
    broadcast(IPC.logsAppended)
  }, 500)
}

/**
 * Credentials are encrypted with Electron safeStorage: Keychain on macOS, DPAPI on Windows,
 * libsecret/kwallet on Linux. Linux without a keyring falls back to a hardcoded key ('basic_text'), so refuse it.
 */
const secureStorageReady = (): boolean =>
  safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')

const noSecureStorage = (): string =>
  t(currentLocale(), process.platform === 'linux' ? 'error.noSecureStorageLinux' : 'error.noSecureStorage')

const safeStorageCrypto = Layer.succeed(SecretCrypto, {
  encrypt: (plain) =>
    Effect.suspend(() =>
      secureStorageReady() ? Effect.try({ try: () => safeStorage.encryptString(plain), catch: (e) => fail(messageOf(e)) }) : Effect.fail(fail(noSecureStorage()))
    ),
  decrypt: (data) => Effect.try({ try: () => safeStorage.decryptString(Buffer.from(data)), catch: (e) => fail(messageOf(e)) })
})

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

/** Sync on purpose: 'close' can be the last thing before the process exits. Temp file + rename, so never half-written. */
function saveSize(win: BrowserWindow): void {
  const { width, height } = win.getNormalBounds()
  const file = stateFile()
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify({ width, height }))
    renameSync(`${file}.tmp`, file)
  } catch (e) {
    console.error('failed to save window state', e)
  }
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
    webPreferences
  })
  mainWin = win
  win.on('closed', () => {
    if (mainWin === win) mainWin = null
    // Windows/Linux quit with the main window: the hidden sound and reminder windows would keep the app running.
    if (!MAC) app.quit()
  })
  win.once('ready-to-show', () => {
    showWindow(win)
    warmReminders()
  })
  lockDown(win)

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
    win.on('close', () => saveSize(win))

  loadRenderer(win)
}

/**
 * The real backend: accounts, sync and the api over them. False when accounts.json can't be read (the user was told,
 * the app should quit). Any other failure leaves the api channels rejecting with the reason.
 */
const startBackend = (dir: string, activity: ActivityLog, track: Track | undefined) =>
  Effect.gen(function* () {
    setClientConfig({
      clientId: import.meta.env.MYSTICALS_GOOGLE_CLIENT_ID,
      clientSecret: import.meta.env.MYSTICALS_GOOGLE_CLIENT_SECRET
    })
    const scope = yield* Effect.scope
    const factories = { caldav: createCaldavProvider, google: createGoogleProvider }
    const opened = yield* Effect.exit(Layer.buildWithScope(AccountStore.layer(dir, factories).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, safeStorageCrypto))), scope))
    if (Exit.isFailure(opened)) {
      // Unreadable accounts.json: say so and quit rather than open a window with no backend. The file is left as is.
      const e = Cause.squash(opened.cause)
      const file = join(dir, 'accounts.json')
      console.error('failed to load accounts', file, e)
      dialog.showErrorBox(t(currentLocale(), 'error.accountsTitle'), t(currentLocale(), 'error.accountsBody', { file, error: messageOf(e) }))
      return false
    }
    const store = Context.get(opened.value, AccountStore)
    yield* Effect.gen(function* () {
      const engine = SyncEngine.layer(changed, {
        triggers: electronTriggers,
        onEvents: (id, notes) => void Effect.runFork(notify(store, activity, id, notes)),
        onSyncing: changed, // renderer re-reads accounts.list for the `syncing` flag
        onResult: (id, r) => void Effect.runFork(logSync(store, activity, id, r))
      })
      const services = Context.merge(opened.value, yield* Layer.buildWithScope(engine, scope).pipe(Effect.provide(opened.value)))
      // The user finishes sign-in in the browser: bring Mysticals back right away so they see the account connect
      // (the sheet shows "connecting" while the code is exchanged); the success page also opens mysticals://.
      const signIn = (): ReturnType<typeof googleSignIn> =>
        googleSignIn((url) => shell.openExternal(url), {
          returnUrl: app.isPackaged ? `${PROTOCOL}://signed-in` : undefined,
          onCode: () => {
            broadcast(IPC.signIn, 'connecting')
            showMain()
            if (MAC && !E2E) app.focus({ steal: true })
          }
        })
      const onAccountAdded = (info: AccountAdded): void => track?.('account_added', info)
      const api = yield* createApi({ verifyCaldav, googleSignIn: signIn, onChanged: changed, onAccountAdded, onAction: activity.append }).pipe(Effect.provide(services))
      registerApi(api, runtime.runPromise)
      yield* startReminders(api, showMain, activity.append)
      yield* Context.get(services, SyncEngine).start
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const e = Cause.squash(cause)
          console.error('backend not ready', e)
          registerApiError(`Backend not ready: ${messageOf(e)}`)
        })
      )
    )
    return true
  })

/** Everything after app ready; long-lived work (sync, timers, listeners, the log writer) lives in the app scope. */
const start = Effect.gen(function* () {
  const userData = app.getPath('userData')
  yield* loadPrefs(userData)
  yield* startLocale
  yield* startClock
  // Dev runs would register the bare Electron binary; electron-builder's `protocols` covers installed builds too.
  if (app.isPackaged && !MOCK) app.setAsDefaultProtocolClient(PROTOCOL)
  const track = yield* startDesktopTelemetry
  const activity = yield* createActivityLog(join(userData, 'logs'), logsAppended)
  yield* registerActivityLog(activity)
  if (MOCK) {
    const api = createMockApi(changed, activity.append)
    registerApi(api, runtime.runPromise)
    yield* startReminders(api, showMain, activity.append)
  } else if (!(yield* startBackend(userData, activity, track))) return app.quit()
  yield* startUpdater
  started = true
  createWindow()
  app.on('activate', () => !mainWin && createWindow())
})

const runtime = ManagedRuntime.make(NodeFileSystem.layer)
const appScope = Scope.makeUnsafe()

app.whenReady().then(() => {
  if (!primary) return
  // Must match appId in electron-builder.yml, or Windows toasts show the wrong name/icon.
  if (process.platform === 'win32') app.setAppUserModelId('com.a1exalexander.mysticals')
  // e2e: no Dock icon and never the active app, so test runs don't take over the Mac.
  if (E2E && MAC) app.setActivationPolicy('accessory')
  nativeTheme.themeSource = 'dark'
  // Settings > Themes: light palettes get a light native frame; the window bg follows --bg (no flash on resize).
  ipcMain.handle(IPC.themeSet, (e, scheme: unknown, bg: unknown) => {
    nativeTheme.themeSource = scheme === 'light' ? 'light' : 'dark'
    if (typeof bg !== 'string' || !/^#[0-9a-f]{6}$/i.test(bg)) return
    themeBg.current = bg
    BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(bg)
  })
  // Packaged builds get the icon from electron-builder; in dev the dock would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  return runtime.runPromise(start.pipe(Scope.provide(appScope)))
}).catch((e) => console.error('startup failed', e))

// Quitting first closes the app scope (sync stops, timers and listeners go, queued log lines are written), then quits
// for real. Bounded, so a stuck finalizer never keeps the app open.
let shutdown: 'no' | 'closing' | 'done' = 'no'
app.on('before-quit', (e) => {
  if (shutdown === 'done') return
  e.preventDefault()
  if (shutdown === 'closing') return
  shutdown = 'closing'
  void runtime
    .runPromise(Scope.close(appScope, Exit.void).pipe(Effect.timeout('3 seconds'), Effect.ignore))
    .then(() => runtime.dispose())
    .catch((err) => console.error('shutdown failed', err))
    .finally(() => {
      shutdown = 'done'
      app.quit()
    })
})

app.on('window-all-closed', () => !MAC && app.quit())
