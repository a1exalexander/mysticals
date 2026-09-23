import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { bus } from '../bus'
import { THEMES, applyTheme, useTheme } from '../theme'
import { KindIcon, Sheet, Swatches, errorText } from './AccountsShared'

const TABS = [
  { id: 'accounts', name: 'Accounts' },
  { id: 'themes', name: 'Themes' },
  { id: 'sync', name: 'Sync' }
] as const
type TabId = (typeof TABS)[number]['id']
/** Last selected tab; survives closing the sheet while the app runs. */
let lastTab: TabId = 'accounts'

// Listens to bus 'settings:open'.
export function SettingsHost(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [tab, setTabState] = useState<TabId>(lastTab)
  const [accounts, setAccounts] = useState<Account[]>([])
  const setTab = (t: TabId): void => {
    lastTab = t
    setTabState(t)
  }

  useEffect(() => bus.on('settings:open', () => setOpen(true)), [])
  useEffect(() => {
    if (!open) return
    const load = (): void => void window.api.accounts.list().then(setAccounts, () => {})
    load()
    return window.api.onChanged(load)
  }, [open])

  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const i = TABS.findIndex((t) => t.id === tab)
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next].id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Settings" testId="settings-sheet">
      <div className="seg set-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="settings-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'active' : undefined}
            data-testid={`settings-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div className="set-panel" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'accounts' && (
          <>
            {accounts.length === 0 ? (
              <p className="acc-note">No accounts yet.</p>
            ) : (
              <ul className="acc-list">
                {accounts.map((a) => (
                  <AccountRow key={a.id} account={a} />
                ))}
              </ul>
            )}
            <div className="acc-actions">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  bus.emit('accounts:open', {})
                }}
              >
                Add account…
              </button>
            </div>
          </>
        )}
        {tab === 'themes' && <ThemePicker />}
        {tab === 'sync' && <SyncPanel accounts={accounts} />}
      </div>
    </Sheet>
  )
}

function ThemePicker(): React.JSX.Element {
  const theme = useTheme()
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className="theme-opt"
          data-testid={`theme-${t.id}`}
          onClick={() => applyTheme(t.id)}
        >
          <span className="theme-swatch" style={{ background: t.preview[0] }} aria-hidden>
            {t.preview.slice(1).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span className="theme-name">
            {t.name}
            {theme === t.id && <span className="on">●</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

function SyncPanel({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const syncAll = async (): Promise<void> => {
    setAll(true)
    // Never rejects; per-account failures land on account.error.
    await window.api.sync.now().catch(() => {})
    setAll(false)
  }
  return (
    <>
      <p className="acc-note">Accounts sync automatically every 2 minutes and when the app regains focus.</p>
      {accounts.length === 0 ? (
        <p className="acc-note">No accounts yet.</p>
      ) : (
        <ul className="acc-list">
          {accounts.map((a) => (
            <SyncRow key={a.id} account={a} busy={all} />
          ))}
        </ul>
      )}
      <div className="acc-actions">
        <button
          type="button"
          className="acc-primary"
          data-testid="sync-all"
          onClick={syncAll}
          disabled={all || accounts.length === 0}
        >
          {all ? 'Syncing…' : 'Sync all'}
        </button>
      </div>
    </>
  )
}

function SyncRow({ account: a, busy }: { account: Account; busy: boolean }): React.JSX.Element {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  // "Sync all" supersedes a stale per-row error; its outcome lands on a.error.
  useEffect(() => {
    if (busy) setError('')
  }, [busy])
  const sync = async (): Promise<void> => {
    setSyncing(true)
    setError('')
    try {
      await window.api.sync.now(a.id)
    } catch (e) {
      setError(errorText(e))
    }
    setSyncing(false)
  }
  const failed = Boolean(error || a.error)
  return (
    <li className="acc-item" data-testid={`sync-${a.id}`}>
      <div className="acc-item-head">
        <span className="acc-dot" style={{ background: a.color }} />
        <KindIcon kind={a.kind} />
        <div className="acc-item-id">
          <span className="set-sync-label">{a.label}</span>
          <span className="acc-email">{a.email}</span>
        </div>
        <span className={failed ? 'set-status err' : 'set-status'}>
          {syncing || busy ? 'syncing' : failed ? 'error' : 'ok'}
        </span>
        <button type="button" onClick={sync} disabled={syncing || busy}>
          Sync now
        </button>
      </div>
      {failed && (
        <p className="acc-error" role="alert">
          {error || `Last sync failed: ${a.error}`}
        </p>
      )}
    </li>
  )
}

function AccountRow({ account: a }: { account: Account }): React.JSX.Element {
  const [label, setLabel] = useState(a.label)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setLabel(a.label), [a.label])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const rename = (): void => {
    const next = label.trim()
    if (!next) return setLabel(a.label)
    if (next !== a.label) void run(() => window.api.accounts.update(a.id, { label: next }))
  }

  return (
    <li className="acc-item" data-testid={`account-${a.id}`}>
      <div className="acc-item-head">
        <span className="acc-dot" style={{ background: a.color }} />
        <KindIcon kind={a.kind} />
        <div className="acc-item-id">
          <input
            className="acc-rename"
            aria-label={`Label for ${a.email}`}
            data-testid={`account-label-${a.id}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.preventDefault()
                setLabel(a.label)
              }
            }}
          />
          <span className="acc-email">{a.email}</span>
        </div>
        <button type="button" className="acc-danger" onClick={() => setConfirm(true)}>
          Remove
        </button>
      </div>
      <Swatches
        value={a.color}
        name={`Colour for ${a.email}`}
        onChange={(color) => void run(() => window.api.accounts.update(a.id, { color }))}
      />
      {error && <p className="acc-error" role="alert">{error}</p>}
      {confirm && (
        <div className="acc-confirm">
          <p>Removes local data and credentials for {a.email}. Nothing is deleted on the server.</p>
          <button type="button" onClick={() => setConfirm(false)}>Cancel</button>
          <button
            type="button"
            className="acc-danger acc-primary-danger"
            data-testid={`account-remove-${a.id}`}
            onClick={() => void run(() => window.api.accounts.remove(a.id))}
          >
            Remove account
          </button>
        </div>
      )}
    </li>
  )
}
