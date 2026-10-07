import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import { App } from './App'
import { ReminderScreen } from './components/ReminderScreen'
import { applyTheme } from './theme'
import { initLocale } from './i18n'

applyTheme()

// The language is known before the first paint, so the UI never flashes English.
void initLocale().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {location.hash === '#reminder' ? <ReminderScreen /> : <App />}
    </StrictMode>
  )
)
