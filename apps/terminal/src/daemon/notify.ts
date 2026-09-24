import { execFile } from 'child_process'
import type { AccountStore } from '@mysticals/core/accounts/store'
import { noteText, type Note } from '@mysticals/core/sync/notify'
import { isMock } from '../paths'

type Run = (file: string, args: string[], done: (e: Error | null) => void) => unknown

// Title/body travel as argv, so no AppleScript string escaping is needed.
const SCRIPT = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run']

/** macOS banners for invites/changes found by sync; events in hidden calendars stay silent. */
export function notify(store: AccountStore, accountId: string, notes: Note[], run: Run = execFile): void {
  if (isMock() || process.platform !== 'darwin') return
  const account = store.get(accountId)
  if (!account) return
  const hidden = new Set(store.hiddenCalendars(accountId))
  const shown = notes.filter((n) => !hidden.has(n.event.calendarId))
  for (const { title, body } of noteText(shown, account.label)) {
    const args = [...SCRIPT.flatMap((l) => ['-e', l]), title, body]
    run('osascript', args, (e) => e && console.error('notification failed', e.message))
  }
}
