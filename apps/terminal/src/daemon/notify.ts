import type { AccountStore } from '@multicals/core/accounts/store'
import type { Note } from '@multicals/core/sync/notify'

/**
 * macOS banners for invites/changes found by sync; events in hidden calendars stay silent.
 * Unit 6 replaces this no-op stub with osascript `display notification` (see core `noteText`).
 */
export function notify(_store: AccountStore, _accountId: string, _notes: Note[]): void {}
