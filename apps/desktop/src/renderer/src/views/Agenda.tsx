import { useEffect, useMemo, useState } from 'react'
import { addDays, differenceInMinutes, format, isSameDay } from 'date-fns'
import type { CalEvent } from '@shared/types'
import { eventMeetingUrl, eventPlace, JOIN_EARLY_MIN, joinable, linkKind, locationText } from '@mysticals/core/logic/meeting'
import { LinkIcon } from '../components/LinkIcon'
import { pickNowNext, startsLabel } from '@mysticals/core/logic/status'
import { eventBounds, isPast, overlapsDay } from '@mysticals/core/logic/layout'
import { bus } from '../bus'
import { useDirectory } from '../components/ui/useDirectory'
import { Notes, PARTSTAT } from '../components/EventDetails'
import { STATUS_ICON } from '@mysticals/core/logic/details'
import { nav } from './nav'
import { eventMenu } from '../components/EventMenu'
import '../components/EventDetails.css'
import type { ColorOf } from './CalendarView'
import './Agenda.css'
import { cap, currentLocale, fmt, t } from '../i18n'

const keyOf = (e: CalEvent): string => `${e.accountId}/${e.id}`
/** How far "show upcoming" looks past the shown day. */
export const AHEAD_DAYS = 7
// Goes through the main process's window-open handler: http(s) only, opened in the system browser / meeting app.
const join = (url: string): void => void window.open(url, '_blank')
const open = (e: CalEvent, el: HTMLElement): void =>
  bus.emit('event:open', { event: e, anchor: el.getBoundingClientRect(), el })

const span = (m: number): string =>
  m < 60 ? t('dur.m', { m }) : m % 60 ? t('dur.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('dur.h', { h: m / 60 })
const dur = (e: CalEvent): string => span(differenceInMinutes(eventBounds(e).end, eventBounds(e).start))

/** Free time before each event of a sorted list, counted from the latest end so far; under 5 minutes is no break. */
function breaksBefore(timed: CalEvent[]): (number | undefined)[] {
  let end = 0
  return timed.map((e, i) => {
    const b = eventBounds(e)
    const gap = i ? differenceInMinutes(b.start, end) : 0
    end = Math.max(end, +b.end)
    return gap >= 5 ? gap : undefined
  })
}
const Gap = ({ m }: { m: number }): React.JSX.Element => (
  <li className="ag-gap" data-testid="agenda-gap">
    {t('agenda.break', { d: span(m) })}
  </li>
)

/** "now · ends in 25m" / "starts in 12m" / "ended 14:30", and the state screen readers hear (soon: within JOIN_EARLY_MIN). */
function statusOf(e: CalEvent, now: Date): { text: string; state?: 'soon' | 'live' | 'ended' } {
  const { start, end } = eventBounds(e)
  if (end <= now) return { text: t('agenda.ended', { time: format(end, 'HH:mm') }), state: 'ended' }
  if (start <= now) return { text: t('agenda.endsIn', { n: Math.max(differenceInMinutes(end, now, { roundingMethod: 'ceil' }), 1) }), state: 'live' }
  return { text: t('agenda.starts', { when: startsLabel(e.start, now, currentLocale()) }), state: +start - +now <= JOIN_EARLY_MIN * 60_000 ? 'soon' : undefined }
}

const TICK = 15_000
/** Ticks every TICK, so join buttons appear on time. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), TICK)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * One day at a glance (today unless stepped away with ‹ ›): the day's events on the left, the selected one (by default
 * the one running now, else the next; nothing once the day is over) on the right with a big "Join call" from
 * JOIN_EARLY_MIN before it starts. Other days are greyed out under a "not today" notice. A toggle at the end of the
 * day opens the next AHEAD_DAYS days below it.
 */
export function Agenda({ day, events, colorOf, ahead, onAhead }: {
  day: Date; events: CalEvent[]; colorOf: ColorOf; ahead: boolean; onAhead: (open: boolean) => void
}): React.JSX.Element {
  const now = useNow()
  const isToday = isSameDay(day, now)
  const { calendars } = useDirectory()
  const sortDay = (d: Date): CalEvent[] =>
    events
      .filter((e) => overlapsDay(e, d))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start))
  const list = useMemo(() => sortDay(day), [events, day])
  const allDay = list.filter((e) => e.allDay)
  const timed = list.filter((e) => !e.allDay)
  // The next few days, below the day's own list when the viewer opens them; empty days are skipped.
  const upcoming = useMemo(
    () =>
      ahead
        ? Array.from({ length: AHEAD_DAYS }, (_, n) => addDays(day, n + 1))
            .map((d) => ({ d, evs: sortDay(d) }))
            .filter((x) => x.evs.length)
        : [],
    [events, day, ahead]
  )
  const upcomingTimed = upcoming.flatMap((x) => x.evs.filter((e) => !e.allDay))
  const walk = [...timed, ...upcomingTimed]
  const { current, next } = isToday ? pickNowNext(timed, now) : { current: [], next: undefined }
  const [picked, setPicked] = useState<string>()
  const focus = walk.find((e) => keyOf(e) === picked) ?? current[0] ?? next
  // While an event runs, the now line crosses that row where "now" falls within it (the latest-started one when
  // several overlap), so it never reads as "already over"; otherwise it goes before the first event still to start.
  const liveAt = timed.reduce((at, e, i) => (current.includes(e) ? i : at), -1)
  const nowAt = !isToday || liveAt >= 0 ? -2 : timed.findIndex((e) => eventBounds(e).start > now)
  const nowIndex = nowAt === -1 ? timed.length : nowAt
  const gaps = useMemo(() => breaksBefore(timed), [timed])
  const pick = (e: CalEvent): void => setPicked(focus === e ? undefined : keyOf(e))
  // Read out from a live region outside the keyed card, so it persists while focus moves: today's call starting soon,
  // starting and ending (the one live on the previous tick, which focus has already left), never the minute countdown.
  // ponytail: assumes ticks TICK apart; a throttled timer (hidden window) can skip an end, keep the previous tick's live
  // event in state if that matters.
  const ended = isToday ? pickNowNext(timed, new Date(+now - TICK)).current.find((e) => eventBounds(e).end <= now) : undefined
  const told = ended ?? current[0] ?? next
  const toldState = told && statusOf(told, now).state

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target as HTMLElement).closest('input, textarea, select')) return
      if (document.querySelector('dialog[open], .mc-overlay, [data-testid="details"]')) return
      const step = ev.key === 'j' || ev.key === 'ArrowDown' ? 1 : ev.key === 'k' || ev.key === 'ArrowUp' ? -1 : 0
      const url = focus && joinable(focus, now)
      // Enter on a button or link activates it; the rows are the list j/k walks, so Enter there joins the selected call.
      const onControl = (ev.target as HTMLElement).closest('button:not(.ag-row), a, [role="button"]')
      if (ev.key === 'Escape' && picked) setPicked(undefined)
      else if (step && walk.length) {
        const i = focus ? walk.indexOf(focus) : -1
        setPicked(keyOf(walk[Math.min(Math.max(i + step, 0), walk.length - 1)]))
      } else if (ev.key === 'Enter' && url && !onControl) join(url)
      else return
      ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [walk, focus, now, picked])

  const chips = (evs: CalEvent[]): React.JSX.Element | null =>
    evs.length ? (
      <div className="ag-allday">
        {evs.map((e) => (
          <button key={keyOf(e)} type="button" className="ag-chip" style={{ '--c': colorOf(e) } as React.CSSProperties} onClick={(ev) => open(e, ev.currentTarget)} {...eventMenu(e)}>
            {e.title || t('common.untitled')}
          </button>
        ))}
      </div>
    ) : null

  return (
    <div className="ag-wrap">
      <div className="ag-sr" role="status" data-testid="agenda-announce">
        {told && toldState && t(`agenda.state.${toldState}`, { title: told.title || t('common.untitled') })}
      </div>
      <div className="ag" data-testid="agenda" data-other-day={!isToday || undefined}>
        <section className="ag-list" aria-label={isToday ? t('common.today') : cap(fmt(day, 'EEEE, d MMMM'))}>
          {!isToday && (
            <div className="ag-other" role="status" data-testid="agenda-other-day">
              <span>{t('agenda.otherDay', { date: cap(fmt(day, 'EEEE, d MMMM')) })}</span>
              <button type="button" className="ag-today-btn" data-testid="agenda-back-today" onClick={() => nav.set({ date: new Date() })}>
                {t('agenda.backToday')}
              </button>
            </div>
          )}
          {chips(allDay)}
          {!timed.length && <p className="ag-empty">{t(isToday ? 'agenda.nothing' : 'agenda.nothingDay')}</p>}
          {isToday && timed.length > 0 && !current.length && !next && <p className="ag-empty">{t('agenda.allDone')}</p>}
          <ol className="ag-rows">
            {timed.flatMap((e, i) => {
              const gap = gaps[i]
              return [
                gap && <Gap key={`gap-${i}`} m={gap} />,
                i === nowIndex && <NowLine key="now" now={now} />,
                <Row key={keyOf(e)} e={e} i={i} now={now} color={colorOf(e)} focused={focus === e} next={e === next} nowLine={i === liveAt} onPick={pick} />
              ]
            })}
            {timed.length > 0 && nowIndex === timed.length && <NowLine now={now} />}
          </ol>
          {/* Stays at the end of the day: opens the next days below it, then hides them again. */}
          <button type="button" className="ag-ahead" data-testid="agenda-ahead-toggle" aria-expanded={ahead} onClick={() => onAhead(!ahead)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={ahead ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
            </svg>
            {ahead ? t('agenda.hideAhead') : t('agenda.showAhead', { n: AHEAD_DAYS })}
          </button>
          {ahead && (
            <div className="ag-upcoming" data-testid="agenda-upcoming">
              {!upcoming.length && <p className="ag-empty">{t('agenda.nothingAhead', { n: AHEAD_DAYS })}</p>}
              {upcoming.map(({ d, evs }) => (
                <section key={d.getTime()} className="ag-day">
                  <h3 className="ag-dayhead">{fmt(d, 'EEE, d MMM')}</h3>
                  {chips(evs.filter((e) => e.allDay))}
                  <ol className="ag-rows">
                    {(() => {
                      const dayTimed = evs.filter((e) => !e.allDay)
                      const dayGaps = breaksBefore(dayTimed)
                      return dayTimed.flatMap((e, i) => [
                        dayGaps[i] && <Gap key={`gap-${i}`} m={dayGaps[i]} />,
                        <Row key={keyOf(e)} e={e} i={i} now={now} color={colorOf(e)} focused={focus === e} onPick={pick} />
                      ])
                    })()}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </section>
        {focus ? (
          <Focus key={keyOf(focus)} e={focus} now={now} color={colorOf(focus)} calendar={calendars.find((c) => c.accountId === focus.accountId && c.id === focus.calendarId)?.name} />
        ) : (
          <section className="ag-focus ag-focus-empty" data-testid="agenda-focus-empty">
            <p>{t(!timed.length ? (isToday ? 'agenda.noCalls' : 'agenda.nothingDay') : isToday && !picked ? 'agenda.allDone' : 'agenda.pickHint')}</p>
          </section>
        )}
      </div>
    </div>
  )
}

/** One timed event: time, calendar bar, title and status; click selects it into the focus card, double click opens details. */
function Row({ e, i, now, color, focused, next, nowLine, onPick }: {
  e: CalEvent; i: number; now: Date; color: string; focused: boolean; next?: boolean; nowLine?: boolean; onPick: (e: CalEvent) => void
}): React.JSX.Element {
  const st = statusOf(e, now)
  const url = joinable(e, now)
  const past = isPast(e, now)
  return (
    <li style={{ '--c': color, '--i': i } as React.CSSProperties}>
      <button
        type="button"
        className="ag-row"
        data-testid={`agenda-row-${e.id}`}
        aria-current={focused}
        data-past={past}
        data-live={st.state === 'live'}
        data-declined={e.myStatus === 'declined'}
        onClick={() => onPick(e)}
        onDoubleClick={(ev) => open(e, ev.currentTarget)}
        {...eventMenu(e)}
      >
        <span className="ag-time">{format(eventBounds(e).start, 'HH:mm')}</span>
        <span className="ag-bar" />
        <span className="ag-main">
          <span className="ag-title">{e.title || t('common.untitled')}</span>
          <span className="ag-meta">
            {st.state === 'live' ? <span className="ag-live">{t('agenda.now')}</span> : !past && next ? startsLabel(e.start, now, currentLocale()) : dur(e)}
            {eventPlace(e, currentLocale()) && ` · ${eventPlace(e, currentLocale())}`}
          </span>
        </span>
      </button>
      {url && (
        <button type="button" className="ag-join-pill" onClick={() => join(url)} title={url}>
          {t('agenda.joinShort')}
        </button>
      )}
      {nowLine && <NowLine now={now} at={progress(e, now)} />}
    </li>
  )
}

/** How far into the event `now` is, 0..1. */
function progress(e: CalEvent, now: Date): number {
  const { start, end } = eventBounds(e)
  const len = +end - +start
  return len > 0 ? Math.min(Math.max((+now - +start) / len, 0), 1) : 0
}

/**
 * Where we are in the day: a line between the events that have started and the ones still to come, or, given `at`
 * (0..1), drawn across the running event's row at that point.
 */
function NowLine({ now, at }: { now: Date; at?: number }): React.JSX.Element {
  const clock = <span className="ag-now-clock">{format(now, 'HH:mm')}</span>
  return at === undefined ? (
    <li className="ag-now" aria-hidden data-testid="agenda-now">
      {clock}
    </li>
  ) : (
    <span className="ag-now ag-now-over" style={{ top: `${at * 100}%` }} aria-hidden data-testid="agenda-now">
      {clock}
    </span>
  )
}

function Focus({ e, now, color, calendar }: { e: CalEvent; now: Date; color: string; calendar?: string }): React.JSX.Element {
  const { start, end } = eventBounds(e)
  const st = statusOf(e, now)
  const url = eventMeetingUrl(e)
  const ready = joinable(e, now)
  const where = locationText(e.location)
  const people = e.attendees.length
  const [showPeople, setShowPeople] = useState(false)
  return (
    <section className="ag-focus" style={{ '--c': color } as React.CSSProperties} data-testid="agenda-focus">
      <div className={st.state === 'live' ? 'ag-status live' : 'ag-status'}>{st.text}</div>
      <h2 className="ag-focus-title">{e.title || t('common.untitled')}</h2>
      <div className="ag-focus-when">
        {format(start, 'HH:mm')} – {format(end, 'HH:mm')} <span>· {dur(e)}</span>
      </div>
      <dl className="ag-facts">
        {calendar && (
          <>
            <dt>{t('agenda.fact.calendar')}</dt>
            <dd>
              <span className="ag-dot" /> {calendar}
            </dd>
          </>
        )}
        {e.organizer && (
          <>
            <dt>{t('agenda.fact.organizer')}</dt>
            <dd title={e.organizer.email} data-testid="agenda-organizer">{e.organizer.name || e.organizer.email}</dd>
          </>
        )}
        {where && (
          <>
            <dt>{t('agenda.fact.where')}</dt>
            <dd>{where}</dd>
          </>
        )}
        {people > 0 && (
          <>
            <dt>{t('agenda.fact.people')}</dt>
            <dd>
              <button
                type="button"
                className="ag-people-toggle"
                data-testid="agenda-people-toggle"
                aria-expanded={showPeople}
                title={t(showPeople ? 'agenda.hidePeople' : 'agenda.showPeople')}
                onClick={() => setShowPeople((v) => !v)}
              >
                {showPeople ? '▾' : '▸'} {t('agenda.people', { n: people })}
              </button>
              {showPeople && (
                <ul className="details-people ag-people" data-testid="agenda-people">
                  {e.attendees.map((a) => (
                    <li key={a.email} title={t(PARTSTAT[a.status])}>
                      <span className={`status ${a.status}`} aria-label={t(PARTSTAT[a.status])}>{STATUS_ICON[a.status]}</span>
                      <span className="who">{a.name ?? a.email}</span>
                      {a.self && <span className="tag">{t('details.you')}</span>}
                      {a.organizer && <span className="tag">{t('details.organizerTag')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </>
        )}
        {url && (
          <>
            <dt>{t('agenda.fact.link')}</dt>
            <dd className="ag-url">
              <a href={url} target="_blank" rel="noreferrer" data-testid="agenda-link">{url}</a>
            </dd>
          </>
        )}
      </dl>
      <Notes text={e.description} className="ag-notes" />
      <div className="ag-actions">
        {ready ? (
          <button type="button" className="ag-join" data-testid="agenda-join" onClick={() => join(ready)}>
            <LinkIcon kind={linkKind(ready)} /> {t('agenda.join')} <kbd>↵</kbd>
          </button>
        ) : (
          url && !isPast(e, now) && <span className="ag-hint">{t('agenda.joinOpens', { n: JOIN_EARLY_MIN })}</span>
        )}
        <button type="button" className="ag-details" onClick={(ev) => open(e, ev.currentTarget)}>
          {t('agenda.details')}
        </button>
      </div>
    </section>
  )
}
