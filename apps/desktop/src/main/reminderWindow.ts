import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { IPC, type ReminderMeeting } from '@shared/ipc'
import { loadRenderer, lockDown, themeBg, webPreferences } from './window'

let win: BrowserWindow | null = null
let meetings: ReminderMeeting[] = []

ipcMain.handle(IPC.reminderScreenMeetings, () => meetings)
ipcMain.handle(IPC.reminderScreenClose, (e, url: unknown) => {
  if (!win || e.sender !== win.webContents) return
  // Only a link that is on the screen: the renderer can't make main open anything else.
  if (typeof url === 'string' && /^https?:\/\//i.test(url) && meetings.some((m) => m.url === url)) void shell.openExternal(url)
  win.close()
})

/**
 * Puts `list` on the Full-screen reminder: opens it over the display under the cursor (fullscreen Spaces included) or
 * updates the open one; an empty list closes it. `onClosed` runs when this window goes, however it was closed.
 */
export function showReminderScreen(list: ReminderMeeting[], onClosed: () => void): void {
  meetings = list
  if (!list.length) return void win?.close()
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
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  lockDown(w)
  w.once('ready-to-show', () => {
    w.show()
    w.focus()
  })
  w.on('closed', () => {
    if (win === w) {
      win = null
      meetings = []
    }
    onClosed()
    if (process.platform === 'darwin' && !hadFocus) app.hide()
  })
  win = w
  loadRenderer(w, 'reminder')
}
