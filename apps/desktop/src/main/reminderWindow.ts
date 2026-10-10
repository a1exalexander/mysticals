import { app, BrowserWindow, ipcMain, screen, shell, type BrowserWindowConstructorOptions, type Rectangle } from 'electron'
import { IPC, type ReminderMeeting } from '@shared/ipc'
import { loadRenderer, lockDown, themeBg, webPreferences } from './window'

/** Native blur behind the screen. Linux has none, so it keeps a solid window. */
const BACKDROP: Partial<Record<NodeJS.Platform, BrowserWindowConstructorOptions>> = {
  darwin: { vibrancy: 'fullscreen-ui', visualEffectState: 'active' },
  win32: { backgroundMaterial: 'acrylic' }
}

/** A dismiss this soon after the screen appears came from keys meant for another app. */
const KEY_GUARD_MS = 1000
/** Shown this long after opening even if the renderer never says its meetings are painted. */
const REVEAL_MS = 3000

let win: BrowserWindow | null = null
// Hidden, renderer loaded, no meetings: the next screen opens in it without the wait. Kept while `warm`.
let spare: BrowserWindow | null = null
let warm = false
let meetings: ReminderMeeting[] = []
let shownAt = Infinity
let onClosed = (): void => {}

/** Detaches the open screen at once (its 'closed' comes later), so a tick in between opens a new one. */
const drop = (): void => {
  const w = win
  win = null
  meetings = []
  w?.close()
  keepSpareScreen(warm)
}

/** Wires the Full-screen reminder's IPC. `closed` runs whenever the user dismisses the screen, however it went. */
export function startReminderScreen(closed: () => void): void {
  onClosed = closed
  ipcMain.handle(IPC.reminderScreenMeetings, (e) => (win && e.sender === win.webContents ? meetings : []))
  ipcMain.handle(IPC.reminderScreenReady, (e) => {
    if (win && e.sender === win.webContents) reveal(win)
  })
  ipcMain.handle(IPC.reminderScreenClose, (e, url: unknown) => {
    if (!win || e.sender !== win.webContents) return
    const join = typeof url === 'string'
    if (!join && Date.now() - shownAt < KEY_GUARD_MS) return
    // Only a link that is on the screen: the renderer can't make main open anything else.
    if (join && /^https?:\/\//i.test(url) && meetings.some((m) => m.url === url)) void shell.openExternal(url)
    drop()
    onClosed()
  })
}

/** Shows the screen and gives it focus, once. */
function reveal(w: BrowserWindow): void {
  if (w !== win || w.isVisible()) return
  w.show()
  // macOS: focus() alone leaves another app frontmost, and Esc/Backspace go there.
  if (process.platform === 'darwin') app.focus({ steal: true })
  w.focus()
  shownAt = Date.now()
}

const cursorDisplay = (): Rectangle => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds

/** A hidden screen window loading the `#reminder` route. */
function createScreen(): BrowserWindow {
  const w = new BrowserWindow({
    ...cursorDisplay(),
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    // Frosted where the OS blurs what is behind (the renderer lays a translucent --bg over it); solid elsewhere.
    ...BACKDROP[process.platform],
    backgroundColor: process.platform in BACKDROP ? '#00000000' : themeBg.current,
    webPreferences
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  lockDown(w)
  w.on('closed', () => {
    if (spare === w) spare = null
    // Still current: closed some other way than drop(), so the screen state goes too.
    if (win === w) {
      win = null
      meetings = []
      onClosed()
    }
  })
  loadRenderer(w, 'reminder')
  return w
}

/** While `on` (the Full-screen reminder setting), keeps a spare screen loaded in the background. Mock runs (e2e) count windows: none there. */
export function keepSpareScreen(on: boolean): void {
  warm = on && process.env.MYSTICALS_MOCK !== '1'
  if (warm) spare ??= createScreen()
  else {
    spare?.close()
    spare = null
  }
}

/**
 * Puts `list` on the Full-screen reminder: opens it over the display under the cursor (fullscreen Spaces included) or
 * updates the open one; an empty list closes it. Resolves once the screen is shown.
 */
export async function showReminderScreen(list: ReminderMeeting[]): Promise<void> {
  if (!list.length) return drop()
  meetings = list
  if (win) return win.webContents.send(IPC.reminderScreenMeetings, list)

  // Focus goes back where it was on dismiss: if another app had it, hide Mysticals so that app is in front again.
  const hadFocus = BrowserWindow.getFocusedWindow() !== null
  const w = spare ?? createScreen()
  spare = null
  win = w
  shownAt = Infinity
  // A spare may have been made on another display.
  w.setBounds(cursorDisplay())
  // A loaded spare gets them now; a new window asks once its renderer is up. Either says when they are painted.
  w.webContents.send(IPC.reminderScreenMeetings, list)
  setTimeout(() => reveal(w), REVEAL_MS)
  return new Promise((done) => {
    w.once('show', () => done())
    w.once('closed', () => {
      done()
      if (process.platform === 'darwin' && !hadFocus && !win) app.hide()
    })
  })
}
