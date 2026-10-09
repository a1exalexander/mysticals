import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import { App } from './App'
import { ReminderScreen } from './components/ReminderScreen'
import { applyTheme } from './theme'
import { initLocale } from './i18n'
import { initClock } from './clock'

applyTheme()

// The language and clock are known before the first paint, so the UI never flashes English or 24-hour times.
void Promise.all([initLocale(), initClock()]).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {location.hash === '#reminder' ? <ReminderScreen /> : <App />}
    </StrictMode>
  )
)
