import { useEffect, useRef, useState } from 'react'
import { addDays } from 'date-fns'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { useDirectory } from './ui/useDirectory'
import { visibleEvents } from '../hooks/useCalendarData'
import { formatWhen, pendingInvites } from './EventDetails.logic'
import { errorText } from './EventEditor.logic'
import './ui/ui.css'
import './Invites.css'

// Status-bar inbox of unanswered invites (next 60 days). Each reply goes through the invite's own account.
export function InvitesPanel(): React.JSX.Element {
  const { accounts, calendars, loaded } = useDirectory()
  const [all, setInvites] = useState<CalEvent[]>([])
  // Hidden calendars are only known once calendars load; show nothing until then.
  const invites = loaded ? visibleEvents(all, calendars) : []
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    const load = (): void => {
      const now = new Date()
      window.api.events
        .list({ start: now.toISOString(), end: addDays(now, 60).toISOString() })
        .then((events) => live && setInvites(pendingInvites(events, now)))
        .catch(console.error)
    }
    load()
    const off = window.api.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [])

  useEffect(() => bus.on('invites:open', () => setOpen((o) => !o)), [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const keyOf = (e: CalEvent): string => `${e.accountId}/${e.id}`
  const reply = (e: CalEvent, status: 'accepted' | 'declined'): void => {
    const k = keyOf(e)
    if (sending.has(k)) return
    setError('')
    setSending((s) => new Set(s).add(k))
    window.api.events
      .respond(e, status)
      .catch((err) => setError(errorText(err)))
      .finally(() => setSending((s) => new Set([...s].filter((x) => x !== k))))
  }

  return (
    <div className="invites" ref={ref}>
      {open && (
        <div className="mc-popover invites-panel">
          <div className="invites-title">Invitations</div>
          {invites.length === 0 && <div className="mc-muted invites-empty">No pending invitations</div>}
          <ul>
            {invites.map((e) => {
              const a = accounts.find((x) => x.id === e.accountId)
              return (
                <li key={keyOf(e)} style={{ '--accent': a?.color ?? 'var(--accent)' } as React.CSSProperties}>
                  <button
                    type="button"
                    className="invites-open"
                    onClick={(ev) => bus.emit('event:open', { event: e, anchor: ev.currentTarget.getBoundingClientRect() })}
                  >
                    <span className="invites-name">{e.title || 'Untitled'}</span>
                    <span className="mc-muted">{formatWhen(e)}</span>
                    <span className="invites-acc"><span className="mc-dot" /> {a?.label ?? e.accountId} · {a?.email}</span>
                  </button>
                  <div className="invites-actions">
                    <button type="button" className="mc-btn primary" disabled={sending.has(keyOf(e))} onClick={() => reply(e, 'accepted')}>Accept</button>
                    <button type="button" className="mc-btn" disabled={sending.has(keyOf(e))} onClick={() => reply(e, 'declined')}>Decline</button>
                  </div>
                </li>
              )
            })}
          </ul>
          {error && <div className="details-error" role="alert">{error}</div>}
        </div>
      )}
      <button
        type="button"
        className={`invites-button${invites.length ? ' has-pending' : ''}`}
        data-testid="invites-button"
        aria-label={`Invitations (${invites.length})`}
        aria-expanded={open}
        title="Invitations (i)"
        onClick={() => setOpen(!open)}
      >
        {invites.length === 1 ? '1 invite' : `${invites.length} invites`}
      </button>
    </div>
  )
}
