import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { IPC, type ReminderMeeting } from '@shared/ipc'
import { loadRenderer, lockDown, themeBg, webPreferences } from './window'

/** A dismiss this soon after the screen appears came from keys meant for another app. */
const KEY_GUARD_MS = 1000

let win: BrowserWindow | null = null
let meetings: ReminderMeeting[] = []
let shownAt = Infinity
let onClosed = (): void => {}

/** Detaches the open screen at once (its 'closed' comes later), so a tick in between opens a new one. */
const drop = (): void => {
  const w = win
  win = null
  meetings = []
  w?.close()
}

/** Wires the Full-screen reminder's IPC. `closed` runs whenever the user dismisses the screen, however it went. */
export function startReminderScreen(closed: () => void): void {
  onClosed = closed
  ipcMain.handle(IPC.reminderScreenMeetings, (e) => (win && e.sender === win.webContents ? meetings : []))
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

/**
 * Puts `list` on the Full-screen reminder: opens it over the display under the cursor (fullscreen Spaces included) or
 * updates the open one; an empty list closes it.
 */
export function showReminderScreen(list: ReminderMeeting[]): void {
  if (!list.length) return drop()
  meetings = list
  if (win) return win.webContents.send(IPC.reminderScreenMeetings, list)

  // Focus goes back where it was on dismiss: if another app had it, hide Mysticals so that app is in front again.
  const hadFocus = BrowserWindow.getFocusedWindow() !== null
  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const w = new BrowserWindow({
    ...bounds,
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
    // Solid, in the theme: never see-through.
    backgroundColor: themeBg.current,
    webPreferences
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  lockDown(w)
  shownAt = Infinity
  w.once('ready-to-show', () => {
    w.show()
    // macOS: focus() alone leaves another app frontmost, and Esc/Backspace go there.
    if (process.platform === 'darwin') app.focus({ steal: true })
    w.focus()
    shownAt = Date.now()
  })
  w.on('closed', () => {
    // Still current: closed some other way than drop(), so the screen state goes too.
    if (win === w) {
      win = null
      meetings = []
      onClosed()
    }
    if (process.platform === 'darwin' && !hadFocus && !win) app.hide()
  })
  win = w
  loadRenderer(w, 'reminder')
}
