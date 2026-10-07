import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { bus } from '../bus'
import { THEMES, applyTheme, themeName, useTheme } from '../theme'
import { KindIcon, Sheet, Swatches, errorText } from './AccountsShared'
import { SegTabs } from './ui/SegTabs'
import { currentLocale, setLanguage, t, useLocale } from '../i18n'
import { LOCALE_NAME, LOCALES, type Key, type LocaleSetting } from '@mysticals/core/i18n'
import { REMINDER_CHOICES } from '@mysticals/core/logic/reminders'
import { LONG_RANGE, LONG_MODES, usesThreshold, type LongMode } from '@mysticals/core/logic/layout'
import { setLongEvents, useLongEvents } from '../longEvents'
import { Select } from './ui/Select'
import { Range } from './ui/Range'
import './ui/ui.css'

const TABS = [
  { id: 'accounts', name: 'settings.tab.accounts' },
  { id: 'themes', name: 'settings.tab.themes' },
  { id: 'events', name: 'settings.tab.events' },
  { id: 'general', name: 'settings.tab.general' }
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
            <AccountsPanel
              accounts={accounts}
              onAdd={() => {
                setOpen(false)
                bus.emit('accounts:open', {})
              }}
            />
          )}
          {tab === 'themes' && <ThemePicker />}
          {tab === 'events' && <EventsPanel />}
          {tab === 'general' && (
            <>
              <h3 className="set-heading set-heading-first">{t('settings.language.title')}</h3>
              <LanguagePicker />
              <h3 className="set-heading">{t('settings.privacy.title')}</h3>
              <PrivacyPanel />
            </>
          )}
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
      <div className="lang-list" role="radiogroup" aria-label={t('settings.language.title')}>
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
  cascade: ['settings.events.cascade', 'settings.events.cascadeHint'],
  expand: ['settings.events.expand', 'settings.events.expandHint']
} as const satisfies Record<LongMode, readonly [Key, Key]>

/** "6.5 h" / "6,5 год": the threshold in the UI language. */
const hoursText = (n: number): string => t('settings.events.hours', { n: n.toLocaleString(currentLocale()) })

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
      <div className={`long-threshold${usesThreshold(long.mode) ? '' : ' is-off'}`}>
        <div className="long-threshold-head">
          <span>{t('settings.events.longer')}</span>
          <b data-testid="long-hours-value">{hoursText(long.hours)}</b>
        </div>
        <Range
          data-testid="long-hours"
          aria-label={t('settings.events.longer')}
          disabled={!usesThreshold(long.mode)}
          {...LONG_RANGE}
          bigStep={1}
          ticks={[1, 3, 6, 9, 12]}
          value={long.hours}
          format={hoursText}
          onChange={(hours) => setLongEvents({ hours })}
        />
      </div>
      {!usesThreshold(long.mode) && <p className="acc-note">{t('settings.events.noThreshold')}</p>}
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
        {usesThreshold(mode) && <span className="lp-busy" />}
        {mode === 'rails' && [0, 1].map((i) => <span key={i} className="lp-rail" style={{ left: 2 + i * 6 }} />)}
        {mode === 'expand' && [0, 1].map((i) => <span key={i} className="lp-long" style={{ left: `${i * 33.3}%` }} />)}
        {mode === 'cascade' && [0, 1].map((i) => <span key={i} className="lp-long lp-stack" style={{ left: 2 + i * 9 }} />)}
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

/**
 * Settings that apply to every account (reminder lead time) on top; below, the accounts listed on the left
 * with "Add account" and "Sync all", and the selected one's details on the right.
 */
function AccountsPanel({ accounts, onAdd }: { accounts: Account[]; onAdd: () => void }): React.JSX.Element {
  useLocale()
  const [all, setAll] = useState(false)
  const [min, setMin] = useState<number>()
  const [muted, setMuted] = useState<string[]>()
  const [fullscreen, setFullscreen] = useState<boolean>()
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => void window.reminders.get().then(setMin, () => {}), [])
  useEffect(() => void window.reminders.muted().then(setMuted, () => {}), [])
  useEffect(() => void window.reminders.fullscreen().then(setFullscreen, () => {}), [])
  const current = accounts.find((a) => a.id === selected) ?? accounts[0]
  const syncAll = async (): Promise<void> => {
    setAll(true)
    // Never rejects; per-account failures land on account.error.
    await window.api.sync.now().catch(() => {})
    setAll(false)
  }
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
  const pickFullscreen = (on: boolean): void => {
    const prev = fullscreen
    setFullscreen(on)
    setError('')
    window.reminders.setFullscreen(on).catch((e) => {
      setFullscreen(prev)
      setError(errorText(e))
    })
  }
  return (
    <div className="acc-panel">
      <div className="acc-reminders">
        <div className="acc-reminders-row">
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
        <label className="set-check">
          <input
            type="checkbox"
            className="mc-check"
            data-testid="fullscreen-reminder-toggle"
            checked={fullscreen ?? false}
            disabled={fullscreen === undefined || !min}
            onChange={(e) => pickFullscreen(e.target.checked)}
          />
          {t('settings.reminders.fullscreen')}
        </label>
        <p className="acc-hint-line">{t('settings.reminders.hint')}</p>
      </div>
      {error && <p className="acc-error" role="alert">{error}</p>}
      <div className="acc-md">
        <div className="acc-md-list">
          <h3 className="set-heading">{t('settings.accounts.title')}</h3>
          <ul aria-label={t('settings.accounts.title')}>
            {accounts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="acc-md-item"
                  aria-current={a.id === current?.id ? 'true' : undefined}
                  data-testid={`account-item-${a.id}`}
                  onClick={() => setSelected(a.id)}
                >
                  <span className="acc-dot" style={{ background: a.color }} />
                  <span className="acc-md-name">
                    <span>{a.label}</span>
                    <span className="acc-md-sub">
                      {a.email.split('@')[1] ?? a.email} · {a.kind === 'google' ? 'Google' : 'CalDAV'}
                    </span>
                  </span>
                  <span className={`acc-state is-${stateOf(a)}`} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="acc-md-add" onClick={onAdd}>
            + {t('settings.addAccount')}
          </button>
          <div className="acc-md-foot">
            <span>{t('settings.accounts.note')}</span>
            <button type="button" data-testid="sync-all" onClick={syncAll} disabled={all || accounts.length === 0}>
              {all ? t('settings.sync.syncing') : t('settings.sync.all')}
            </button>
          </div>
        </div>
        {current ? (
          <AccountDetail
            key={current.id}
            account={current}
            syncingAll={all}
            notify={muted === undefined ? undefined : !muted.includes(current.id)}
            onNotify={(on) => toggle(current.id, on)}
          />
        ) : (
          <div className="acc-md-detail acc-md-empty">
            <p className="acc-note">{t('settings.noAccounts')}</p>
            <button type="button" className="acc-primary" onClick={onAdd}>
              {t('settings.addAccount')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The list dot: ok, syncing, failed or signed out. */
const stateOf = (a: Account): 'ok' | 'syncing' | 'err' => (a.syncing ? 'syncing' : a.error || a.authError ? 'err' : 'ok')

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

interface DetailProps {
  account: Account
  /** "Sync all" is running. */
  syncingAll: boolean
  /** Whether this account notifies; undefined while loading. */
  notify: boolean | undefined
  onNotify: (on: boolean) => void
}

function AccountDetail({ account: a, syncingAll, notify, onNotify }: DetailProps): React.JSX.Element {
  const [label, setLabel] = useState(a.label)
  const [confirm, setConfirm] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [error, setError] = useState('')

  useEffect(() => setLabel(a.label), [a.label])
  // "Sync all" supersedes a stale per-account error; its outcome lands on a.error.
  useEffect(() => {
    if (syncingAll) setSyncError('')
  }, [syncingAll])

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
  const sync = async (): Promise<void> => {
    setSyncing(true)
    setSyncError('')
    try {
      await window.api.sync.now(a.id)
    } catch (e) {
      setSyncError(errorText(e))
    }
    setSyncing(false)
  }
  const failed = Boolean(syncError || a.error)
  const busy = syncing || syncingAll

  return (
    <section className="acc-md-detail" data-testid={`account-${a.id}`} aria-label={a.label}>
      <header className="acc-md-head">
        <span className="acc-avatar" style={{ '--acc': a.color } as React.CSSProperties}>
          <KindIcon kind={a.kind} />
        </span>
        <div className="acc-item-id">
          <strong>{a.label}</strong>
          <span className="acc-email">{a.email}</span>
        </div>
      </header>
      <div className="acc-fields">
        <label htmlFor={`account-label-${a.id}`}>{t('settings.account.name')}</label>
        <input
          id={`account-label-${a.id}`}
          className="acc-name"
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
        <span>{t('settings.account.colour')}</span>
        <Swatches
          value={a.color}
          name={t('settings.account.colourFor', { email: a.email })}
          onChange={(color) => void run(() => window.api.accounts.update(a.id, { color }))}
        />
        <span>{t('settings.reminders.accountSwitch')}</span>
        <label className="set-check set-notify">
          <input
            type="checkbox"
            role="switch"
            className="mc-switch"
            data-testid={`notify-account-${a.id}`}
            aria-label={t('settings.reminders.accountFor', { name: a.label })}
            checked={notify ?? false}
            disabled={notify === undefined}
            onChange={(e) => onNotify(e.target.checked)}
          />
          <span className="acc-hint-line">{t('settings.reminders.accountHint')}</span>
        </label>
        <span>{t('settings.account.sync')}</span>
        <div className="acc-sync" data-testid={`sync-${a.id}`}>
          <span className={`set-status${busy ? ' busy' : failed ? ' err' : ''}`}>
            {busy ? t('settings.sync.stateSyncing') : failed ? t('settings.sync.stateError') : t('settings.sync.stateOk')}
          </span>
          {a.authError ? (
            <button type="button" className="acc-primary" onClick={() => bus.emit('reauth:open', { accountId: a.id })}>
              {t('settings.reconnect')}
            </button>
          ) : (
            <button type="button" onClick={sync} disabled={busy}>
              {t('settings.sync.now')}
            </button>
          )}
        </div>
      </div>
      {failed && (
        <p className="acc-error" role="alert">
          {syncError || t('settings.sync.lastFailed', { error: a.error ?? '' })}
        </p>
      )}
      {error && <p className="acc-error" role="alert">{error}</p>}
      {confirm ? (
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
      ) : (
        <div className="acc-md-danger">
          <button type="button" className="acc-danger acc-remove" onClick={() => setConfirm(true)}>
            {t('settings.account.remove')}
          </button>
        </div>
      )}
    </section>
  )
}
