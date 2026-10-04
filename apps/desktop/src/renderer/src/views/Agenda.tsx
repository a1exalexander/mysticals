import { useEffect, useMemo, useState } from 'react'
import { differenceInMinutes, format } from 'date-fns'
import type { CalEvent } from '@shared/types'
import { eventMeetingUrl, eventPlace, JOIN_EARLY_MIN, joinable, linkKind, locationText } from '@mysticals/core/logic/meeting'
import { LinkIcon } from '../components/LinkIcon'
import { pickNowNext, startsLabel } from '@mysticals/core/logic/status'
import { eventBounds, isPast, overlapsDay } from '@mysticals/core/logic/layout'
import { bus } from '../bus'
import { useDirectory } from '../components/ui/useDirectory'
import type { ColorOf } from './CalendarView'
import './Agenda.css'

const keyOf = (e: CalEvent): string => `${e.accountId}/${e.id}`
// Goes through the main process's window-open handler: http(s) only, opened in the system browser / meeting app.
const join = (url: string): void => void window.open(url, '_blank')
const open = (e: CalEvent, el: HTMLElement): void =>
  bus.emit('event:open', { event: e, anchor: el.getBoundingClientRect(), el })

const dur = (e: CalEvent): string => {
  const m = differenceInMinutes(eventBounds(e).end, eventBounds(e).start)
  return m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`
}

/** "now · ends in 25m" / "starts in 12m" / "ended 14:30". */
function statusOf(e: CalEvent, now: Date): { text: string; live?: boolean } {
  const { start, end } = eventBounds(e)
  if (end <= now) return { text: `ended ${format(end, 'HH:mm')}` }
  if (start <= now) return { text: `now · ends in ${Math.max(differenceInMinutes(end, now, { roundingMethod: 'ceil' }), 1)}m`, live: true }
  return { text: `starts ${startsLabel(e.start, now)}` }
}

/** Ticks every 15s, so join buttons appear on time. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * Today at a glance: the day's events on the left, the selected one (by default the one running now, else the next)
 * on the right with a big "Join call" from JOIN_EARLY_MIN before it starts.
 */
export function Agenda({ events, colorOf }: { events: CalEvent[]; colorOf: ColorOf }): React.JSX.Element {
  const now = useNow()
  const { calendars } = useDirectory()
  const today = useMemo(
    () =>
      events
        .filter((e) => overlapsDay(e, now))
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start)),
    [events, now]
  )
  const allDay = today.filter((e) => e.allDay)
  const timed = today.filter((e) => !e.allDay)
  const { current, next } = pickNowNext(timed, now)
  const [picked, setPicked] = useState<string>()
  const focus = timed.find((e) => keyOf(e) === picked) ?? current[0] ?? next ?? timed[timed.length - 1]

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target as HTMLElement).closest('input, textarea, select')) return
      if (document.querySelector('dialog[open], .mc-overlay, [data-testid="details"]')) return
      const step = ev.key === 'j' || ev.key === 'ArrowDown' ? 1 : ev.key === 'k' || ev.key === 'ArrowUp' ? -1 : 0
      const url = focus && joinable(focus, now)
      if (step && timed.length) {
        const i = focus ? timed.indexOf(focus) : -1
        setPicked(keyOf(timed[Math.min(Math.max(i + step, 0), timed.length - 1)]))
      } else if (ev.key === 'Enter' && url) join(url)
      else return
      ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [timed, focus, now])

  return (
    <div className="ag-wrap">
      <div className="ag" data-testid="agenda">
        <section className="ag-list" aria-label="Today">
          {allDay.length > 0 && (
            <div className="ag-allday">
              {allDay.map((e) => (
                <button key={keyOf(e)} type="button" className="ag-chip" style={{ '--c': colorOf(e) } as React.CSSProperties} onClick={(ev) => open(e, ev.currentTarget)}>
                  {e.title || 'Untitled'}
                </button>
              ))}
            </div>
          )}
          {!timed.length && <p className="ag-empty">Nothing scheduled today.</p>}
          {timed.length > 0 && !current.length && !next && <p className="ag-empty">All done for today.</p>}
          <ol className="ag-rows">
            {timed.map((e, i) => {
              const k = keyOf(e)
              const st = statusOf(e, now)
              const url = joinable(e, now)
              const past = isPast(e, now)
              return (
                <li key={k} style={{ '--c': colorOf(e), '--i': i } as React.CSSProperties}>
                  <button
                    type="button"
                    className="ag-row"
                    data-testid={`agenda-row-${e.id}`}
                    aria-current={focus === e}
                    data-past={past}
                    data-live={st.live}
                    data-declined={e.myStatus === 'declined'}
                    onClick={() => setPicked(k)}
                    onDoubleClick={(ev) => open(e, ev.currentTarget)}
                  >
                    <span className="ag-time">{format(eventBounds(e).start, 'HH:mm')}</span>
                    <span className="ag-bar" />
                    <span className="ag-main">
                      <span className="ag-title">{e.title || 'Untitled'}</span>
                      <span className="ag-meta">
                        {st.live ? <span className="ag-live">● now</span> : !past && e === next ? startsLabel(e.start, now) : dur(e)}
                        {eventPlace(e) && ` · ${eventPlace(e)}`}
                      </span>
                    </span>
                  </button>
                  {url && (
                    <button type="button" className="ag-join-pill" onClick={() => join(url)} title={url}>
                      Join
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
        {focus ? (
          <Focus key={keyOf(focus)} e={focus} now={now} color={colorOf(focus)} calendar={calendars.find((c) => c.accountId === focus.accountId && c.id === focus.calendarId)?.name} />
        ) : (
          <section className="ag-focus ag-focus-empty">
            <p>No calls today. Enjoy the quiet.</p>
          </section>
        )}
      </div>
    </div>
  )
}

function Focus({ e, now, color, calendar }: { e: CalEvent; now: Date; color: string; calendar?: string }): React.JSX.Element {
  const { start, end } = eventBounds(e)
  const st = statusOf(e, now)
  const url = eventMeetingUrl(e)
  const ready = joinable(e, now)
  const where = locationText(e.location)
  const people = e.attendees.length
  return (
    <section className="ag-focus" style={{ '--c': color } as React.CSSProperties} data-testid="agenda-focus" aria-live="polite">
      <div className={st.live ? 'ag-status live' : 'ag-status'}>{st.text}</div>
      <h2 className="ag-focus-title">{e.title || 'Untitled'}</h2>
      <div className="ag-focus-when">
        {format(start, 'HH:mm')} – {format(end, 'HH:mm')} <span>· {dur(e)}</span>
      </div>
      <dl className="ag-facts">
        {calendar && (
          <>
            <dt>calendar</dt>
            <dd>
              <span className="ag-dot" /> {calendar}
            </dd>
          </>
        )}
        {where && (
          <>
            <dt>where</dt>
            <dd>{where}</dd>
          </>
        )}
        {people > 0 && (
          <>
            <dt>people</dt>
            <dd>{people === 1 ? '1 person' : `${people} people`}</dd>
          </>
        )}
        {url && (
          <>
            <dt>link</dt>
            <dd className="ag-url">{url}</dd>
          </>
        )}
      </dl>
      <div className="ag-actions">
        {ready ? (
          <button type="button" className="ag-join" data-testid="agenda-join" onClick={() => join(ready)}>
            <LinkIcon kind={linkKind(ready)} /> Join call <kbd>↵</kbd>
          </button>
        ) : (
          url && !isPast(e, now) && <span className="ag-hint">Join opens {JOIN_EARLY_MIN} min before start</span>
        )}
        <button type="button" className="ag-details" onClick={(ev) => open(e, ev.currentTarget)}>
          Details
        </button>
      </div>
    </section>
  )
}
