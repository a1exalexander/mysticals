import { useEffect, useState } from 'react'
import { bus } from '../bus'
import { useCalendarData } from '../hooks/useCalendarData'
import { MiniMonth } from './MiniMonth'

/** Mini-month + one section per account listing ONLY that account's calendars. */
export function Sidebar(): React.JSX.Element {
  const { accounts, calendars } = useCalendarData()
  // Optimistic toggles, dropped once fresh calendars arrive (or reverted on error).
  const [pending, setPending] = useState<Record<string, boolean>>({})
  useEffect(() => setPending({}), [calendars])
  const toggle = (accountId: string, calendarId: string, visible: boolean): void => {
    const k = `${accountId}/${calendarId}`
    setPending((p) => ({ ...p, [k]: visible }))
    window.api.calendars.setVisible(accountId, calendarId, visible).catch((e) => {
      console.error(e)
      setPending(({ [k]: _, ...rest }) => rest)
    })
  }
  return (
    <aside className="sidebar">
      <MiniMonth />
      <div className="sb-accounts">
        {accounts.map((a) => (
          <section key={a.id} className="sb-account" data-testid={`sidebar-account-${a.id}`}>
            <header className="sb-account-head">
              <span className="sb-dot" style={{ background: a.color }} />
              <span className="sb-label">{a.label}</span>
              {a.error && (
                <span className="sb-error" title={a.error} aria-label={`Sync error: ${a.error}`}>
                  !
                </span>
              )}
              <span className="sb-email">{a.email}</span>
            </header>
            {calendars
              .filter((c) => c.accountId === a.id)
              .map((c) => (
                <label key={c.id} className="sb-cal">
                  <input
                    type="checkbox"
                    data-testid={`sidebar-calendar-${a.id}-${c.id}`}
                    checked={pending[`${a.id}/${c.id}`] ?? c.visible !== false}
                    style={{ accentColor: c.color }}
                    onChange={(e) => toggle(a.id, c.id, e.target.checked)}
                  />
                  <span className="sb-cal-name">{c.name}</span>
                  {c.readOnly && <span className="sb-ro" title="Read-only">read-only</span>}
                </label>
              ))}
          </section>
        ))}
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
