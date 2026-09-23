import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { CalendarView } from './views/CalendarView'
import { EventEditorHost } from './components/EventEditor'
import { EventDetailsHost } from './components/EventDetails'
import { AccountsHost } from './components/Accounts'
import { SettingsHost } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { EventTooltipHost } from './components/EventTooltip'
import { useDirectory } from './components/ui/useDirectory'

// Layout shell. Each child is owned by a different unit; communicate via ./bus.
export function App(): React.JSX.Element {
  const { loaded } = useDirectory()
  // Never trap the UI behind the loader if the first load fails.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 5000)
    return () => clearTimeout(t)
  }, [])
  const done = loaded || timedOut
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <CalendarView />
      </main>
      <StatusBar />
      <EventEditorHost />
      <EventDetailsHost />
      <AccountsHost />
      <SettingsHost />
      <EventTooltipHost />
      <div className="app-loader" data-done={done} aria-hidden={done} role="status" aria-label="Loading">
        <div className="app-loader-term">
          <div><span className="app-loader-prompt">~ $</span> multicals --sync</div>
          <div className="app-loader-spin">
            loading accounts… <span className="app-loader-cursor" />
          </div>
        </div>
      </div>
    </div>
  )
}
