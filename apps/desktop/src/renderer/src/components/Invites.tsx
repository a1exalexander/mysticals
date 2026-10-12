import { useEffect, useRef, useState } from 'react'
import { addDays } from 'date-fns'
import { Effect, Result } from 'effect'
import { live } from '@mysticals/core/sync/live'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { useDirectory } from './ui/useDirectory'
import { visibleEvents } from '@mysticals/core/logic/visible'
import { formatWhen, ownerLine, pendingInvites } from '@mysticals/core/logic/details'
import { eventKey } from '@mysticals/core/logic/layout'
import { usePopoverFocus } from './ui/usePopover'
import './ui/ui.css'
import './Invites.css'
import { currentLocale, t, useLocale } from '../i18n'
import { hour12 } from '../clock'
import { ipc } from '../ipc'

// Status-bar inbox of unanswered invites (next 60 days). Each reply goes through the invite's own account.
export function InvitesPanel(): React.JSX.Element {
  const { accounts, calendars, loaded } = useDirectory()
  useLocale()
  const [all, setInvites] = useState<CalEvent[]>([])
  // Hidden calendars are only known once calendars load; show nothing until then.
  const invites = loaded ? visibleEvents(all, calendars) : []
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  usePopoverFocus(open, () => ref.current?.querySelector<HTMLElement>('.invites-title'))

  useEffect(() => {
    const load = Effect.suspend(() => {
      const now = new Date()
      return ipc.api.events
        .list({ start: now.toISOString(), end: addDays(now, 60).toISOString() })
        .pipe(Effect.map((events) => pendingInvites(events, now)))
    })
    return live(window.api.onChanged, load, (r) => (Result.isSuccess(r) ? setInvites(r.success) : console.error(r.failure)))
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

  const reply = (e: CalEvent, status: 'accepted' | 'declined'): void => {
    const k = eventKey(e)
    if (sending.has(k)) return
    setError('')
    setSending((s) => new Set(s).add(k))
    Effect.runFork(
      ipc.api.events.respond(e, status).pipe(
        Effect.catch((err) => Effect.sync(() => setError(err.message))),
        Effect.ensuring(Effect.sync(() => setSending((s) => new Set([...s].filter((x) => x !== k)))))
      )
    )
  }

  return (
    <div className="invites" ref={ref}>
      {open && (
        <div className="mc-popover invites-panel">
          <div className="invites-title" tabIndex={-1}>{t('invites.title')}</div>
          {invites.length === 0 && <div className="mc-muted invites-empty">{t('invites.empty')}</div>}
          <ul>
            {invites.map((e) => {
              const a = accounts.find((x) => x.id === e.accountId)
              const o = ownerLine(undefined, a?.label ?? e.accountId, a?.email)
              return (
                <li key={eventKey(e)} style={{ '--cal': a?.color } as React.CSSProperties}>
                  <button
                    type="button"
                    className="invites-open"
                    onClick={(ev) => bus.emit('event:open', { event: e, anchor: ev.currentTarget.getBoundingClientRect(), el: ev.currentTarget })}
                  >
                    <span className="invites-name">{e.title || t('common.untitled')}</span>
                    <span className="mc-muted">{formatWhen(e, currentLocale(), hour12())}</span>
                    <span className="invites-acc"><span className="mc-dot" /> {o.label}{o.email && <> · {o.email}</>}</span>
                  </button>
                  <div className="invites-actions">
                    <button type="button" className="mc-btn primary" disabled={sending.has(eventKey(e))} onClick={() => reply(e, 'accepted')}>{t('rsvp.accept')}</button>
                    <button type="button" className="mc-btn" disabled={sending.has(eventKey(e))} onClick={() => reply(e, 'declined')}>{t('rsvp.decline')}</button>
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
        aria-label={t('invites.aria', { n: invites.length })}
        aria-expanded={open}
        title={t('invites.hint')}
        onClick={() => setOpen(!open)}
      >
        {t('invites.count', { n: invites.length })}
      </button>
    </div>
  )
}
