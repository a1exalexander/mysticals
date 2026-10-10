import { useEffect, useState } from 'react'
import type { ReminderMeeting } from '@shared/ipc'
import { linkKind, linkLabel } from '@mysticals/core/logic/meeting'
import { currentLocale, t, useLocale } from '../i18n'
import { hm, useClock } from '../clock'
import { followTheme } from '../theme'
import './ReminderScreen.css'

/** The Full-screen reminder window (`#reminder`): every due meeting with a Call link, until Join, Esc or Backspace. */
export function ReminderScreen(): React.JSX.Element {
  useLocale()
  useClock()
  const [meetings, setMeetings] = useState<ReminderMeeting[]>([])
  const [now, setNow] = useState(Date.now)
  // The window opens hidden (a spare one long before it is due) and main shows and focuses it once its meetings are
  // painted: the enter animation waits for that, or it plays unseen.
  const [shown, setShown] = useState(false)
  const due = meetings.length > 0
  useEffect(() => {
    if (!due || shown) return
    // Main shows the window once told the cards are committed, and answers after: the enter animation starts then.
    // Not focus or visibility: a hidden window can report both. Not requestAnimationFrame: it gets no frames.
    const show = (): void => setShown(true)
    void window.reminderScreen.ready().then(show, show)
  }, [due, shown])
  useEffect(() => {
    // A spare window waited a while: count down from when the meetings came.
    const take = (list: ReminderMeeting[]): void => {
      setNow(Date.now())
      setMeetings(list)
    }
    void window.reminderScreen.meetings().then(take, () => {})
    const off = window.reminderScreen.onMeetings(take)
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' && e.key !== 'Backspace') return
      e.preventDefault()
      // Main ignores this in the first second after the window shows: those keys were meant for another app.
      void window.reminderScreen.close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('storage', followTheme)
    return () => {
      off()
      clearInterval(timer)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('storage', followTheme)
    }
  }, [])
  return (
    <main className="rs" data-shown={shown || undefined} aria-label={t('reminder.screen')}>
      <button type="button" className="rs-close" aria-label={t('reminder.close')} title={t('reminder.close')} onClick={() => void window.reminderScreen.close()}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <h1 className="rs-heading">{t('reminder.screen')}</h1>
      <div className="rs-list">
        {meetings.map((m, i) => (
          <Card key={m.key} m={m} now={now} i={i} />
        ))}
      </div>
      <p className="rs-hint">{t('reminder.dismiss')}</p>
    </main>
  )
}

function Card({ m, now, i }: { m: ReminderMeeting; now: number; i: number }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const start = new Date(m.start)
  const min = Math.ceil((start.getTime() - now) / 60_000)
  const copy = (): void =>
    void navigator.clipboard.writeText(m.url).then(
      () => setCopied(true),
      () => {}
    )
  return (
    <article className="rs-card" style={{ '--i': i } as React.CSSProperties}>
      <div className="rs-meta">
        <span className="mc-dot" style={{ background: m.color || undefined }} />
        <span className="rs-account">{m.account}</span>
        <span className="rs-when">{min > 0 ? t('reminder.in', { n: min }) : t('reminder.now')}</span>
      </div>
      <h2 className="rs-title">{m.title || t('common.untitled')}</h2>
      <div className="rs-time">
        {hm(start)}–{hm(new Date(m.end))}
      </div>
      <button type="button" className="mc-btn primary rs-join" onClick={() => void window.reminderScreen.close(m.url)}>
        {linkLabel(m.url, linkKind(m.url), currentLocale())}
      </button>
      <div className="rs-link">
        <input className="rs-url" readOnly value={m.url} aria-label={t('reminder.link')} onFocus={(e) => e.target.select()} />
        <button type="button" className="mc-btn" onClick={copy}>
          {copied ? t('reminder.copied') : t('reminder.copy')}
        </button>
      </div>
    </article>
  )
}
