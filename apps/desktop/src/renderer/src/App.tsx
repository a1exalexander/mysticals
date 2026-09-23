import { Sidebar } from './components/Sidebar'
import { CalendarView } from './views/CalendarView'
import { EventEditorHost } from './components/EventEditor'
import { EventDetailsHost } from './components/EventDetails'
import { AccountsHost } from './components/Accounts'
import { SettingsHost } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { EventTooltipHost } from './components/EventTooltip'

// Layout shell. Each child is owned by a different unit; communicate via ./bus.
export function App(): React.JSX.Element {
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
    </div>
  )
}
