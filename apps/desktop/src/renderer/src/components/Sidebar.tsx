import { useState } from 'react'
import { bus } from '../bus'
import { setCalendarVisible, useCalendarData } from '../hooks/useCalendarData'
import { MiniMonth } from './MiniMonth'

const COLLAPSED_KEY = 'mysticals-collapsed-accounts'

function readCollapsed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  } catch {
    // storage unavailable or corrupt: everything expanded
  }
  return []
}

/** Mini-month + one section per account listing ONLY that account's calendars. */
export function Sidebar(): React.JSX.Element {
  const { accounts, calendars } = useCalendarData()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleAccount = (id: string): void => {
    const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
    } catch {
      // per-device preference only; ignore
    }
  }
  return (
    <aside className="sidebar">
      <MiniMonth />
      <div className="sb-accounts">
        {accounts.map((a) => {
          const open = !collapsed.includes(a.id)
          const cals = calendars.filter((c) => c.accountId === a.id)
          // Before its first sync lands an account has no calendars yet: say so instead of showing nothing.
          const loading = !a.synced && !cals.length && !!a.syncing
          const failed = !a.synced && !cals.length && !a.syncing && !!a.error
          return (
            <section key={a.id} className="sb-account" data-testid={`sidebar-account-${a.id}`}>
              <button
                type="button"
                className="sb-account-head"
                aria-expanded={open}
                data-testid={`sidebar-account-toggle-${a.id}`}
                onClick={() => toggleAccount(a.id)}
              >
                <svg className="sb-arrow" viewBox="0 0 10 10" width="10" height="10" aria-hidden>
                  <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="sb-dot" style={{ background: a.color }} />
                <span className="sb-label">{a.label}</span>
                {loading ? (
                  <span className="sb-spin" aria-hidden />
                ) : (
                  a.error && (
                    <span className="sb-error" title={a.error} aria-label={`Sync error: ${a.error}`}>
                      !
                    </span>
                  )
                )}
                <span className="sb-email">{a.email}</span>
              </button>
              {open && loading && (
                <div className="sb-loading" role="status" data-testid={`sidebar-loading-${a.id}`}>
                  {[70, 45].map((w) => (
                    <span key={w} className="sb-skel-row" aria-hidden>
                      <i className="sb-skel sb-skel-box" />
                      <i className="sb-skel" style={{ width: `${w}%` }} />
                    </span>
                  ))}
                  <span className="sb-loading-text">Loading calendars…</span>
                </div>
              )}
              {open && failed && (
                <div className="sb-loading sb-failed" role="alert">
                  <span className="sb-loading-text">Couldn&apos;t load calendars</span>
                  <button type="button" className="sb-retry" onClick={() => void window.api.sync.now(a.id).catch(() => {})}>
                    retry
                  </button>
                </div>
              )}
              {open &&
                cals.map((c) => (
                  <label key={c.id} className="sb-cal">
                    <input
                      type="checkbox"
                      data-testid={`sidebar-calendar-${a.id}-${c.id}`}
                      checked={c.visible !== false}
                      style={{ accentColor: c.color }}
                      onChange={(e) => setCalendarVisible(a.id, c.id, e.target.checked)}
                    />
                    <span className="sb-cal-name">{c.name}</span>
                    {c.readOnly && <span className="sb-ro" title="Read-only">read-only</span>}
                  </label>
                ))}
            </section>
          )
        })}
      </div>
      <footer className="sb-foot">
        <button className="sb-add" onClick={() => bus.emit('accounts:open', {})}>
          <span aria-hidden>＋</span> Add calendar
        </button>
        <button className="sb-gear" aria-label="Settings" title="Settings" onClick={() => bus.emit('settings:open', {})}>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
            <path
              fill="currentColor"
              d="M9.4 1l.3 1.8c.4.1.8.3 1.1.5l1.5-1 1.4 1.4-1 1.5c.2.3.4.7.5 1.1L15 6.6v2l-1.8.3c-.1.4-.3.8-.5 1.1l1 1.5-1.4 1.4-1.5-1c-.3.2-.7.4-1.1.5L9.4 15h-2l-.3-1.8c-.4-.1-.8-.3-1.1-.5l-1.5 1-1.4-1.4 1-1.5c-.2-.3-.4-.7-.5-1.1L1.8 9.4v-2l1.8-.3c.1-.4.3-.8.5-1.1l-1-1.5 1.4-1.4 1.5 1c.3-.2.7-.4 1.1-.5L7.4 1h2zm-1 4.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z"
            />
          </svg>
        </button>
      </footer>
    </aside>
  )
}
