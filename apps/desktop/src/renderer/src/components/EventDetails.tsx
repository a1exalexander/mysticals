import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, subDays } from 'date-fns'
import type { CalEvent, DeleteScope, PartStat } from '@shared/types'
import { bus } from '../bus'
import { useDirectory } from './ui/useDirectory'
import { RecurringScope } from './ui/RecurringScope'
import { canEdit, cleanNotes, formatWhen, isHtml, linkify, ownerLine, STATUS_ICON } from '@mysticals/core/logic/details'
import { errorText } from '@mysticals/core/logic/editor'
import { eventBounds } from '@mysticals/core/logic/layout'
import { eventLinks, linkLabel, locationText } from '@mysticals/core/logic/meeting'
import { LinkIcon } from './LinkIcon'
import { notesFragment } from './notesHtml'
import './ui/ui.css'
import './EventDetails.css'
import type { Key } from '@mysticals/core/i18n'
import { currentLocale, t, useLocale } from '../i18n'

type Reply = Exclude<PartStat, 'needsAction'>
const REPLIES: [Reply, Key][] = [['accepted', 'rsvp.accept'], ['tentative', 'rsvp.maybe'], ['declined', 'rsvp.decline']]
export const PARTSTAT: Record<PartStat, Key> = {
  accepted: 'partstat.accepted',
  tentative: 'partstat.tentative',
  declined: 'partstat.declined',
  needsAction: 'partstat.needsAction'
}
const W = 320
const GAP = 8

// Details popover + RSVP. Replies go only through the account that owns the event.
export function EventDetailsHost(): React.JSX.Element | null {
  const { accounts, calendars } = useDirectory()
  useLocale()
  const [opened, setOpened] = useState<{ event: CalEvent; anchor?: DOMRect; el?: HTMLElement } | null>(null)
  // Deleted elsewhere (another device, the web) while shown: kept open with a notice instead of vanishing.
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showPeople, setShowPeople] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const current = useRef<string | null>(null) // id of the shown event; late replies for another event are dropped
  current.current = opened ? `${opened.event.accountId}/${opened.event.id}` : null

  useEffect(
    () =>
      bus.on('event:open', (o) => {
        setOpened(o)
        setBusy(false)
        setError('')
        setConfirmDelete(false)
        setShowPeople(false)
        setGone(false)
        setPos(null)
      }),
    []
  )

  useEffect(() => {
    if (!opened) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpened(null)
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpened(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [opened])

  // Place beside the anchor (right, else left), clamped to the window. The anchor element is re-measured, so a
  // resized window (the grid reflows) or a taller popover (invitees, notices) moves it along.
  const place = useCallback((): void => {
    if (!opened || !ref.current) return
    const h = ref.current.offsetHeight
    const a = opened.el?.isConnected ? opened.el.getBoundingClientRect() : opened.anchor
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = a ? (a.right + GAP + W <= vw ? a.right + GAP : a.left - GAP - W) : (vw - W) / 2
    let top = a ? a.top : (vh - h) / 3
    left = Math.max(12, Math.min(left, vw - W - 12))
    top = Math.max(12, Math.min(top, vh - h - 12))
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }))
  }, [opened])
  useLayoutEffect(place, [place])
  useEffect(() => {
    const el = ref.current
    if (!opened || !el) return
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [opened, place])

  // Follow the event while shown: edits from elsewhere update it, a deletion shows a notice.
  const deleting = useRef(false) // our own Delete: the popover closes, no notice
  const accountId = opened?.event.accountId
  const eventId = opened?.event.id
  useEffect(() => {
    if (!opened || !accountId || !eventId) return
    let live = true
    const b = eventBounds(opened.event)
    // A window around the event: finds it after small moves without pulling every cached event over IPC.
    const range = { start: subDays(b.start, 60).toISOString(), end: addDays(b.end, 60).toISOString() }
    const off = window.api.onChanged((changed) => {
      if (changed !== accountId) return
      window.api.events.list(range).then((events) => {
        if (!live || deleting.current) return
        const fresh = events.find((e) => e.accountId === accountId && e.id === eventId)
        setGone(!fresh)
        if (fresh) setOpened((o) => (o && o.event.id === eventId ? { ...o, event: fresh } : o))
      }, console.error)
    })
    return () => {
      live = false
      off()
    }
    // Re-subscribes per shown event, not per refreshed copy of it.
  }, [accountId, eventId])

  if (!opened) return null

  const { event } = opened
  const account = accounts.find((a) => a.id === event.accountId)
  const calendar = calendars.find((c) => c.accountId === event.accountId && c.id === event.calendarId)
  const editable = canEdit(event, account, calendar)
  const notes = cleanNotes(event.description)
  const links = eventLinks(event)
  const where = locationText(event.location)
  const owner = ownerLine(calendar?.name ?? t('editor.calendar'), account?.label ?? event.accountId, account?.email)

  const key = `${event.accountId}/${event.id}`
  const still = (): boolean => current.current === key
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      if (still()) setError(errorText(e))
    } finally {
      if (still()) setBusy(false)
    }
  }
  const respond = (status: Reply): Promise<void> =>
    run(async () => {
      const updated = await window.api.events.respond(event, status)
      if (still()) setOpened((o) => o && { ...o, event: updated })
    })
  const remove = (scope: DeleteScope = 'one'): Promise<void> =>
    run(async () => {
      deleting.current = true
      try {
        await window.api.events.delete(event, scope)
        if (still()) setOpened(null)
      } finally {
        deleting.current = false
      }
    })

  return (
    <>
      <div
        ref={ref}
        className={`mc-popover details${gone ? ' is-gone' : ''}`}
        data-testid="details"
        role="dialog"
        aria-label={event.title}
        style={{ '--accent': calendar?.color ?? account?.color ?? 'var(--accent)', left: pos?.left ?? -9999, top: pos?.top ?? 0 } as React.CSSProperties}
      >
        {gone && (
          <div className="details-gone" role="alert" data-testid="details-gone">
            <span className="details-gone-icon" aria-hidden>✕</span>
            <div>
              <b>{t('details.deleted')}</b>
              <span>{owner.calendar ? t('details.deletedFrom', { calendar: owner.calendar }) : t('details.deletedFromCalendar')}</span>
            </div>
            <button type="button" className="mc-btn" onClick={() => setOpened(null)}>{t('common.close')}</button>
          </div>
        )}
        <div className="details-head">
          <span className="mc-dot details-dot" />
          <h2>{event.title || t('common.untitled')}</h2>
        </div>
        <div className="details-when">{formatWhen(event, currentLocale())}</div>
        <div className="details-owner mc-muted">
          {owner.calendar && <>{t('details.calendarIn', { calendar: owner.calendar })} </>}<b>{owner.label}</b>
          {owner.email && <> · {owner.email}</>}
        </div>

        {where && <Row label={t('editor.location')}>{where}</Row>}
        {links.length > 0 && (
          <div className="details-links">
            {links.map((l) => (
              <a
                key={l.url}
                className={`mc-btn details-linkbtn${l.kind === 'map' || l.kind === 'link' ? '' : ' call'}`}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                title={l.url}
                data-kind={l.kind}
              >
                <LinkIcon kind={l.kind} />
                <span>{linkLabel(l.url, l.kind, currentLocale())}</span>
              </a>
            ))}
          </div>
        )}
        {event.organizer && (
          <Row label={t('details.organizer')}>{event.organizer.name ? `${event.organizer.name} <${event.organizer.email}>` : event.organizer.email}</Row>
        )}
        {event.attendees.length > 0 && (
          <div className="details-invitees">
            <button
              type="button"
              className="details-toggle"
              data-testid="invitees-toggle"
              aria-expanded={showPeople}
              onClick={() => setShowPeople((v) => !v)}
            >
              {showPeople ? '▾' : '▸'} {t('details.invitees', { n: event.attendees.length })}
            </button>
            {showPeople && <ul className="details-people">
              {event.attendees.map((a) => (
                <li key={a.email} title={t(PARTSTAT[a.status])}>
                  <span className={`status ${a.status}`} aria-label={t(PARTSTAT[a.status])}>{STATUS_ICON[a.status]}</span>
                  <span className="who">{a.name ?? a.email}</span>
                  {a.self && <span className="tag">{t('details.you')}</span>}
                  {a.organizer && <span className="tag">{t('details.organizerTag')}</span>}
                </li>
              ))}
            </ul>}
          </div>
        )}
        {notes && (isHtml(notes) ? <HtmlNotes html={notes} /> : <p className="details-notes"><Linkified text={notes} /></p>)}

        {!gone && event.myStatus && (
          <div className="details-rsvp">
            <div className="mc-seg" role="group" aria-label={t('rsvp.reply')}>
              {REPLIES.map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  data-testid={`rsvp-${s}`}
                  className={event.myStatus === s ? 'on' : ''}
                  data-status={s}
                  aria-pressed={event.myStatus === s}
                  disabled={busy}
                  onClick={() => respond(s)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            <div className="mc-muted details-replyas">{t('rsvp.replyAs', { email: account?.email ?? event.accountId })}</div>
          </div>
        )}

        {error && <div className="details-error" role="alert">{error}</div>}

        {editable && !gone &&
          (confirmDelete && event.recurringEventId ? (
            <RecurringScope title={t('scope.delete')} danger busy={busy} onPick={remove} onCancel={() => setConfirmDelete(false)} />
          ) : confirmDelete ? (
            <div className="mc-actions details-confirm">
              <span>{t('details.confirmDelete')}</span>
              <button type="button" className="mc-btn" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
              <button type="button" className="mc-btn danger primary" disabled={busy} onClick={() => remove()}>{t('common.delete')}</button>
            </div>
          ) : (
            <div className="mc-actions">
              <button type="button" className="mc-btn danger" onClick={() => setConfirmDelete(true)}>{t('common.delete')}</button>
              <button
                type="button"
                className="mc-btn"
                onClick={() => {
                  setOpened(null)
                  bus.emit('event:edit', { event })
                }}
              >
                {t('common.edit')}
              </button>
            </div>
          ))}
      </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="details-row">
      <div className="mc-muted">{label}</div>
      <div>{children}</div>
    </div>
  )
}

/** HTML descriptions (Google) render formatted, only after sanitizing to inert tags and http(s) links. */
function HtmlNotes({ html }: { html: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current?.replaceChildren(notesFragment(html))
  }, [html])
  return <div ref={ref} className="details-notes is-html" />
}

function Linkified({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.href ? (
          <a key={i} className="details-link" href={p.href} target="_blank" rel="noreferrer">
            {p.text}
          </a>
        ) : (
          p.text
        )
      )}
    </>
  )
}
