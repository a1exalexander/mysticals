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
