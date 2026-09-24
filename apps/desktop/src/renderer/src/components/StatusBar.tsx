import { format } from 'date-fns'
import { useCalendarData } from '../hooks/useCalendarData'
import { visibleEvents } from '@mysticals/core/logic/visible'
import { useNav } from '../views/nav'
import { rangeLabel, viewDays } from '@mysticals/core/logic/layout'
import { InvitesPanel } from './Invites'
import { useEffect, useState } from 'react'
import { addHours } from 'date-fns'
import type { CalEvent } from '@shared/types'
import type { UpdateState } from '@shared/ipc'
import { bus } from '../bus'
import { useDirectory } from './ui/useDirectory'
import { pickNowNext, startsLabel } from '@mysticals/core/logic/status'

/** Events happening now (max 2, then +N) and the next one within 24h; click opens details. */
function NowNext(): React.JSX.Element {
  const { accounts, calendars, loaded } = useDirectory()
  const [events, setEvents] = useState<CalEvent[]>([])
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let live = true
    let seq = 0
    const load = (): void => {
      const my = ++seq
      const t = new Date()
      setNow(t)
      window.api.events
        .list({ start: t.toISOString(), end: addHours(t, 24).toISOString() })
        .then((evs) => live && my === seq && setEvents(evs))
        .catch(console.error)
    }
    load()
    const off = window.api.onChanged(load)
    const id = window.setInterval(load, 60_000)
    return () => {
      live = false
      off()
      window.clearInterval(id)
    }
  }, [])

  const colorOf = (e: CalEvent): string | undefined =>
    calendars.find((c) => c.accountId === e.accountId && c.id === e.calendarId)?.color ??
    accounts.find((a) => a.id === e.accountId)?.color
  const { current, next } = pickNowNext(loaded ? visibleEvents(events, calendars) : [], now)
  const item = (e: CalEvent, label: React.ReactNode): React.JSX.Element => (
    <button
      key={`${e.accountId}/${e.id}`}
      type="button"
      className="sbar-seg sbar-ev"
      style={{ '--c': colorOf(e) } as React.CSSProperties}
      title={e.title}
      onClick={(ev) => bus.emit('event:open', { event: e, anchor: ev.currentTarget.getBoundingClientRect() })}
    >
      {label}
    </button>
  )

  return (
    <div className="sbar-events" data-testid="sbar-events">
      {current.slice(0, 2).map((e) =>
        item(
          e,
          <>
            <span className="sbar-dot" aria-hidden>●</span>
            <span className="sbar-title">{e.title}</span>· until {format(new Date(e.end), 'HH:mm')}
          </>
        )
      )}
      {current.length > 2 && <span className="sbar-seg">+{current.length - 2}</span>}
      {next &&
        item(
          next,
          <>
            <span className="sbar-dim">next:</span>
            <span className="sbar-title">{next.title}</span>· {startsLabel(next.start, now)}
          </>
        )}
      {!current.length && !next && <span className="sbar-seg sbar-dim">no upcoming events</span>}
    </div>
  )
}

/** Self-update: offer → download progress → restart; errors keep a retry. */
function UpdateItem(): React.JSX.Element | null {
  const [s, setS] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    void window.update.state().then(setS, () => {})
    return window.update.onUpdate(setS)
  }, [])
  const install = (): void => void window.update.install()
  switch (s.status) {
    case 'available':
      return (
        <button type="button" className="sbar-seg sbar-upd" data-testid="sbar-update" onClick={install}>
          ↑ Update to {s.version}
        </button>
      )
    case 'downloading':
      return <span className="sbar-seg" data-testid="sbar-update">Downloading {s.progress ?? 0}%</span>
    case 'ready':
      return <span className="sbar-seg" data-testid="sbar-update">Restarting…</span>
    case 'error':
      return (
        <button type="button" className="sbar-seg sbar-err" data-testid="sbar-update" title={s.error} onClick={install}>
          ✕ update failed · retry
        </button>
      )
    default:
      return null
  }
}

/** vim-like bottom line: current view + range, per-account sync state, invites, key hints. */
export function StatusBar(): React.JSX.Element {
  const { view, date } = useNav()
  const { accounts } = useCalendarData()
  const days = viewDays(view, date)
  const range =
    view === 'day'
      ? format(date, 'EEE d MMM yyyy')
      : view === 'month'
        ? format(date, 'MMMM yyyy')
        : rangeLabel(days[0], days[days.length - 1])

  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="sbar-mode">{view}</span>
      <span className="sbar-seg">{range}</span>
      <NowNext />
      {accounts.some((a) => a.error) && (
        <button
          type="button"
          className="sbar-seg sbar-err"
          title={accounts.filter((a) => a.error).map((a) => `${a.label}: ${a.error}`).join('\n')}
          onClick={() => bus.emit('settings:open', {})}
        >
          ✕ sync error
        </button>
      )}
      <span className="sbar-grow" />
      <UpdateItem />
      <span className="sbar-keys" aria-hidden>
        <kbd>n</kbd> new · <kbd>t</kbd> today · <kbd>h</kbd>/<kbd>l</kbd> · <kbd>d</kbd>/<kbd>3</kbd>/<kbd>w</kbd>/<kbd>m</kbd> · <kbd>i</kbd> invites
      </span>
      <InvitesPanel />
    </footer>
  )
}
