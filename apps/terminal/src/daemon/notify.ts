import { execFile } from 'child_process'
import { Effect } from 'effect'
import type { AccountStoreShape } from '@mysticals/core/accounts/store'
import { noteText, type Note } from '@mysticals/core/sync/notify'
import { isMock } from '../paths'

type Run = (file: string, args: string[], opts: { env?: NodeJS.ProcessEnv; windowsHide: true }, done: (e: Error | null) => void) => unknown

// Title/body travel as argv, so no AppleScript string escaping is needed.
const SCRIPT = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run']

// Windows toast through WinRT from Windows PowerShell. Text comes in via env vars, never spliced into the script.
// ponytail: shows under PowerShell's app id; register an AUMID if the "Windows PowerShell" header bothers anyone.
const TOAST = [
  '$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
  '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  '$t = $x.GetElementsByTagName("text")',
  '$null = $t.Item(0).AppendChild($x.CreateTextNode($env:MYSTICALS_NOTE_TITLE))',
  '$null = $t.Item(1).AppendChild($x.CreateTextNode($env:MYSTICALS_NOTE_BODY))',
  '$id = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))'
].join('; ')

/** The command that shows one banner on `platform`, or undefined where we have none. */
export function bannerCommand(
  title: string,
  body: string,
  platform = process.platform
): { file: string; args: string[]; env?: NodeJS.ProcessEnv } | undefined {
  if (platform === 'darwin') return { file: 'osascript', args: [...SCRIPT.flatMap((l) => ['-e', l]), title, body] }
  if (platform === 'linux') return { file: 'notify-send', args: ['--app-name=mysticals', '--', title, body] }
  if (platform === 'win32')
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', TOAST],
      env: { ...process.env, MYSTICALS_NOTE_TITLE: title, MYSTICALS_NOTE_BODY: body }
    }
  return undefined
}

/** OS banners for invites/changes found by sync, two at a time; events in hidden calendars stay silent. */
export const notify = (
  store: Pick<AccountStoreShape, 'get' | 'hiddenCalendars'>,
  accountId: string,
  notes: Note[],
  run: Run = execFile,
  platform = process.platform
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (isMock()) return
    const account = yield* store.get(accountId)
    if (!account) return
    const hidden = new Set(yield* Effect.orElseSucceed(store.hiddenCalendars(accountId), () => []))
    const shown = notes.filter((n) => !hidden.has(n.event.calendarId))
    const commands = noteText(shown, account.label).map(({ title, body }) => bannerCommand(title, body, platform))
    if (commands.some((c) => !c)) return
    yield* Effect.forEach(
      commands as NonNullable<(typeof commands)[number]>[],
      (cmd) =>
        Effect.callback<void>((resume) => {
          run(cmd.file, cmd.args, { env: cmd.env, windowsHide: true }, (e) => {
            if (e) console.error('notification failed', e.message)
            resume(Effect.void)
          })
        }),
      { concurrency: 2, discard: true }
    )
  })
