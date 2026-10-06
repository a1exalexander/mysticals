import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { CalendarView } from './views/CalendarView'
import { EventEditorHost } from './components/EventEditor'
import { EventDetailsHost } from './components/EventDetails'
import { AccountsHost } from './components/Accounts'
import { SettingsHost } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { EventTooltipHost } from './components/EventTooltip'
import { ToastHost } from './components/Toast'
import { ScopePromptHost } from './components/ScopePrompt'
import { EventMenuHost } from './components/EventMenu'
import { ReauthHost } from './components/Reauth'
import { useDirectory } from './components/ui/useDirectory'
import { t, useLocale } from './i18n'
import { toggleSidebar, useSidebarCollapsed } from './sidebar'

// Layout shell. Each child is owned by a different unit; communicate via ./bus.
export function App(): React.JSX.Element {
  const { loaded } = useDirectory()
  useLocale()
  // Never trap the UI behind the loader if the first load fails.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 5000)
    return () => clearTimeout(t)
  }, [])
  const done = loaded || timedOut
  const collapsed = useSidebarCollapsed()
  // ⌘\ / Ctrl+\ shows or hides the sidebar (the View menu only displays the shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key !== '\\') return
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="app" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <Sidebar collapsed={collapsed} />
      {/* The one sidebar toggle, on the sidebar's right edge at toolbar height; it rides the column as it folds. */}
      <button
        type="button"
        className="sidebar-toggle"
        data-testid="sidebar-toggle"
        aria-expanded={!collapsed}
        aria-label={t(collapsed ? 'toolbar.showSidebar' : 'toolbar.hideSidebar')}
        title={`${t(collapsed ? 'toolbar.showSidebar' : 'toolbar.hideSidebar')} (${document.documentElement.dataset.platform === 'darwin' ? '⌘' : 'Ctrl+'}\\)`}
        onClick={toggleSidebar}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
          <path className="sidebar-toggle-pane" d="M5 4h4v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" stroke="none" />
          <path className="sidebar-toggle-chev" d="M16.5 9l-3 3 3 3" />
        </svg>
      </button>
      <main className="main">
        <CalendarView />
      </main>
      <StatusBar />
      <EventEditorHost />
      <EventDetailsHost />
      <AccountsHost />
      <SettingsHost />
      <EventTooltipHost />
      <EventMenuHost />
      <ToastHost />
      <ScopePromptHost />
      <ReauthHost />
      <div className="app-loader" data-done={done} aria-hidden={done} role="status" aria-label={t('app.loading')}>
        <div className="app-loader-term">
          <div><span className="app-loader-prompt">~ $</span> mysticals --sync</div>
          <div className="app-loader-spin">
            {t('app.loadingAccounts')} <span className="app-loader-cursor" />
          </div>
        </div>
      </div>
    </div>
  )
}
