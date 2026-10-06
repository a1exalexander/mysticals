import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { bus } from '../bus'
import { THEMES, applyTheme, themeName, useTheme } from '../theme'
import { KindIcon, Sheet, Swatches, errorText } from './AccountsShared'
import { SegTabs } from './ui/SegTabs'
import { setLanguage, t, useLocale } from '../i18n'
import { LOCALE_NAME, LOCALES, type Key, type LocaleSetting } from '@mysticals/core/i18n'
import { extraEmail } from '@mysticals/core/logic/details'
import { REMINDER_CHOICES } from '@mysticals/core/logic/reminders'
import { LONG_HOURS, LONG_MODES, type LongMode } from '@mysticals/core/logic/layout'
import { setLongEvents, useLongEvents } from '../longEvents'
import { Select } from './ui/Select'
import './ui/ui.css'

const TABS = [
  { id: 'accounts', name: 'settings.tab.accounts' },
  { id: 'themes', name: 'settings.tab.themes' },
  { id: 'events', name: 'settings.tab.events' },
  { id: 'language', name: 'settings.tab.language' },
  { id: 'sync', name: 'settings.tab.sync' },
  { id: 'notifications', name: 'settings.tab.notifications' },
  { id: 'privacy', name: 'settings.tab.privacy' }
] as const satisfies readonly { id: string; name: Key }[]
type TabId = (typeof TABS)[number]['id']
/** Last selected tab; survives closing the sheet while the app runs. */
let lastTab: TabId = 'accounts'

// Listens to bus 'settings:open'.
export function SettingsHost(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [tab, setTabState] = useState<TabId>(lastTab)
  const [accounts, setAccounts] = useState<Account[]>([])
  useLocale()
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

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title={t('settings.title')} testId="settings-sheet">
      <div className="set-body">
        <nav className="set-side">
          <SegTabs
            tabs={TABS.map((tb) => ({ id: tb.id, label: t(tb.name) }))}
            value={tab}
            onChange={setTab}
            ariaLabel={t('settings.sections')}
            className="set-tabs"
            testId={(id) => `settings-tab-${id}`}
            tabId={(id) => `settings-tab-${id}`}
            controls="settings-panel"
            orientation="vertical"
          />
          <p className="set-made" data-testid="made-in-ukraine">
            <svg viewBox="0 0 3 2" aria-hidden>
              <rect width="3" height="1" fill="#0057B7" />
              <rect y="1" width="3" height="1" fill="#FFD700" />
            </svg>
            Made in Ukraine
            <span aria-hidden>·</span>
            <a href="https://ko-fi.com/a1exalexander" target="_blank" rel="noreferrer" data-testid="donate-link">
              {t('settings.donate')}
            </a>
          </p>
        </nav>
        <div className="set-panel" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
          {tab === 'accounts' && (
            <>
              {accounts.length === 0 ? (
                <p className="acc-note">{t('settings.noAccounts')}</p>
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
                  {t('settings.addAccount')}
                </button>
              </div>
            </>
          )}
          {tab === 'themes' && <ThemePicker />}
          {tab === 'events' && <EventsPanel />}
          {tab === 'language' && <LanguagePicker />}
          {tab === 'sync' && <SyncPanel accounts={accounts} />}
          {tab === 'notifications' && <RemindersPanel accounts={accounts} />}
          {tab === 'privacy' && <PrivacyPanel />}
        </div>
      </div>
    </Sheet>
  )
}

/** Automatic (the OS language), or a fixed one; each language is named in itself. */
function LanguagePicker(): React.JSX.Element {
  const { setting, system } = useLocale()
  const [error, setError] = useState('')
  const pick = (next: LocaleSetting): void => {
    setError('')
    setLanguage(next).catch((e) => setError(errorText(e)))
  }
  const options: { id: LocaleSetting; name: string; hint?: string }[] = [
    { id: 'auto', name: t('settings.language.auto'), hint: t('settings.language.system', { name: LOCALE_NAME[system] }) },
    ...LOCALES.map((l) => ({ id: l, name: LOCALE_NAME[l] }))
  ]
  return (
    <>
      <div className="lang-list" role="radiogroup" aria-label={t('settings.tab.language')}>
        {options.map((o) => (
          <label key={o.id} className="set-check lang-opt" data-testid={`language-${o.id}`}>
            <input type="radio" className="mc-radio" name="language" checked={setting === o.id} onChange={() => pick(o.id)} />
            {o.name}
            {o.hint && <span className="acc-email">{o.hint}</span>}
          </label>
        ))}
      </div>
      {error && <p className="acc-error" role="alert">{error}</p>}
    </>
  )
}

const MODE_TEXT = {
  rails: ['settings.events.rails', 'settings.events.railsHint'],
  allday: ['settings.events.allday', 'settings.events.alldayHint'],
  expand: ['settings.events.expand', 'settings.events.expandHint']
} as const satisfies Record<LongMode, readonly [Key, Key]>

/** How timed events longer than a threshold show in the day grids; a per-device preference. */
function EventsPanel(): React.JSX.Element {
  const long = useLongEvents()
  return (
    <>
      <h3 className="set-heading set-heading-first">{t('settings.events.long')}</h3>
      <p className="acc-note">{t('settings.events.note')}</p>
      <div className="long-grid" role="radiogroup" aria-label={t('settings.events.mode')}>
        {LONG_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={long.mode === m}
            className="long-opt"
            data-testid={`long-mode-${m}`}
            onClick={() => setLongEvents({ mode: m })}
          >
            <LongPreview mode={m} />
            <span className="theme-name">
              {t(MODE_TEXT[m][0])}
              {long.mode === m && <span className="on">●</span>}
            </span>
            <span className="long-hint">{t(MODE_TEXT[m][1])}</span>
          </button>
        ))}
      </div>
      <div className="set-check long-threshold">
        <span>{t('settings.events.longer')}</span>
        <Select
          compact
          data-testid="long-hours"
          aria-label={t('settings.events.longer')}
          disabled={long.mode === 'expand'}
          value={String(long.hours)}
          options={LONG_HOURS.map((n) => ({ value: String(n), label: t('settings.events.hours', { n }) }))}
          onChange={(v) => setLongEvents({ hours: Number(v) })}
        />
      </div>
      {long.mode === 'expand' && <p className="acc-note">{t('settings.events.noThreshold')}</p>}
    </>
  )
}

/** A mini day column: three long blocks and one short meeting, drawn the way each mode would. */
function LongPreview({ mode }: { mode: LongMode }): React.JSX.Element {
  return (
    <span className={`long-preview is-${mode}`} aria-hidden>
      {mode === 'allday' && (
        <span className="lp-allday">
          <i /><i />
        </span>
      )}
      <span className="lp-grid">
        {mode !== 'expand' && <span className="lp-busy" />}
        {mode === 'rails' && [0, 1].map((i) => <span key={i} className="lp-rail" style={{ left: 2 + i * 6 }} />)}
        {mode === 'expand' && [0, 1].map((i) => <span key={i} className="lp-long" style={{ left: `${i * 33.3}%` }} />)}
        <span className="lp-meet" />
      </span>
    </span>
  )
}

function ThemePicker(): React.JSX.Element {
  const theme = useTheme()
  return (
    <div className="theme-grid" role="radiogroup" aria-label={t('settings.theme')}>
      {THEMES.map((th) => (
        <button
          key={th.id}
          type="button"
          role="radio"
          aria-checked={theme === th.id}
          className="theme-opt"
          data-testid={`theme-${th.id}`}
          onClick={() => applyTheme(th.id)}
        >
          <span className="theme-swatch" style={{ background: th.preview[0] }} aria-hidden>
            {th.preview.slice(1).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span className="theme-name">
            {themeName(th)}
            {theme === th.id && <span className="on">●</span>}
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
      <p className="acc-note">{t('settings.sync.note')}</p>
      {accounts.length === 0 ? (
        <p className="acc-note">{t('settings.noAccounts')}</p>
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
          {all ? t('settings.sync.syncing') : t('settings.sync.all')}
        </button>
      </div>
    </>
  )
}

/** How many minutes before an event its reminder pops up, or off; and which accounts notify at all. */
function RemindersPanel({ accounts }: { accounts: Account[] }): React.JSX.Element {
  useLocale()
  const [min, setMin] = useState<number>()
  const [muted, setMuted] = useState<string[]>()
  const [error, setError] = useState('')
  useEffect(() => void window.reminders.get().then(setMin, () => {}), [])
  useEffect(() => void window.reminders.muted().then(setMuted, () => {}), [])
  const toggle = (id: string, on: boolean): void => {
    const prev = muted
    setMuted((m) => (on ? m?.filter((x) => x !== id) : [...(m ?? []), id]))
    setError('')
    window.reminders.setMuted(id, !on).catch((e) => {
      setMuted(prev)
      setError(errorText(e))
    })
  }
  const pick = (next: number): void => {
    const prev = min
    setMin(next)
    setError('')
    window.reminders.set(next).catch((e) => {
      setMin(prev)
      setError(errorText(e))
    })
  }
  return (
    <>
      <p className="acc-note">{t('settings.reminders.note')}</p>
      <div className="set-check">
        <span>{t('settings.reminders.label')}</span>
        <Select
          compact
          data-testid="reminder-select"
          aria-label={t('settings.reminders.label')}
          disabled={min === undefined}
          value={min === undefined ? '' : String(min)}
          options={REMINDER_CHOICES.map((n) => ({
            value: String(n),
            label: n ? t('settings.reminders.min', { n }) : t('settings.reminders.off')
          }))}
          onChange={(v) => pick(Number(v))}
        />
      </div>
      {accounts.length > 0 && (
        <>
          <h3 className="set-heading">{t('settings.reminders.accounts')}</h3>
          <p className="acc-note">{t('settings.reminders.accountsNote')}</p>
          <ul className="acc-list">
            {accounts.map((a) => (
              <li key={a.id} className="acc-item">
                <label className="acc-item-head set-notify">
                  <span className="acc-dot" style={{ background: a.color }} />
                  <KindIcon kind={a.kind} />
                  <span className="acc-item-id">
                    <span className="set-sync-label">{a.label}</span>
                    {extraEmail(a.label, a.email) && <span className="acc-email">{a.email}</span>}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="mc-switch"
                    data-testid={`notify-account-${a.id}`}
                    aria-label={t('settings.reminders.accountFor', { name: a.label })}
                    checked={muted !== undefined && !muted.includes(a.id)}
                    disabled={muted === undefined}
                    onChange={(e) => toggle(a.id, e.target.checked)}
                  />
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="acc-error" role="alert">{error}</p>}
    </>
  )
}

function PrivacyPanel(): React.JSX.Element {
  const [on, setOn] = useState<boolean>()
  useEffect(() => void window.telemetry.enabled().then(setOn, () => {}), [])
  const toggle = (next: boolean): void => {
    setOn(next)
    void window.telemetry.setEnabled(next).catch(() => {})
  }
  return (
    <>
      <p className="acc-note">
        {t('settings.privacy.note')}{' '}
        <a href="https://mysticals.sashkoratushnyi.com/privacy/" target="_blank" rel="noreferrer">
          {t('settings.privacy.policy')}
        </a>
      </p>
      <label className="set-check">
        <input
          type="checkbox"
          className="mc-check"
          data-testid="telemetry-toggle"
          checked={on ?? false}
          disabled={on === undefined}
          onChange={(e) => toggle(e.target.checked)}
        />
        {t('settings.privacy.share')}
      </label>
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
          {extraEmail(a.label, a.email) && <span className="acc-email">{a.email}</span>}
        </div>
        <span className={failed ? 'set-status err' : 'set-status'}>
          {syncing || busy ? t('settings.sync.stateSyncing') : failed ? t('settings.sync.stateError') : t('settings.sync.stateOk')}
        </span>
        {a.authError ? (
          <button type="button" className="acc-primary" onClick={() => bus.emit('reauth:open', { accountId: a.id })}>
            {t('settings.reconnect')}
          </button>
        ) : (
          <button type="button" onClick={sync} disabled={syncing || busy}>
            {t('settings.sync.now')}
          </button>
        )}
      </div>
      {failed && (
        <p className="acc-error" role="alert">
          {error || t('settings.sync.lastFailed', { error: a.error ?? '' })}
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
            aria-label={t('settings.account.labelFor', { email: a.email })}
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
          {t('settings.account.remove')}
        </button>
      </div>
      <Swatches
        value={a.color}
        name={t('settings.account.colourFor', { email: a.email })}
        onChange={(color) => void run(() => window.api.accounts.update(a.id, { color }))}
      />
      {error && <p className="acc-error" role="alert">{error}</p>}
      {confirm && (
        <div className="acc-confirm">
          <p>{t('settings.account.removeNote', { email: a.email })}</p>
          <button type="button" onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
          <button
            type="button"
            className="acc-danger acc-primary-danger"
            data-testid={`account-remove-${a.id}`}
            onClick={() => void run(() => window.api.accounts.remove(a.id))}
          >
            {t('settings.account.removeConfirm')}
          </button>
        </div>
      )}
    </li>
  )
}
