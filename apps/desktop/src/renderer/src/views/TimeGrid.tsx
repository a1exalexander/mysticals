import { useEffect, useRef, useState } from 'react'
import { addDays, format, isSameDay, isToday, startOfDay } from 'date-fns'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { tooltipHover } from '../components/EventTooltip'
import { meetingUrl, place } from '@mysticals/core/logic/meeting'
import { nav } from './nav'
import { dragRange, eventBounds, eventsOnDay, isPast, layoutDay, slotAt, statusClass, ymd } from '@mysticals/core/logic/layout'
import type { CanDrag, ColorOf, MoveTo } from './CalendarView'
import { moveRange, resizeEnd } from './drag'

const HOUR = 48 // px per hour
const MIN_DUR = 22 // minutes; shorter events render (and pack) as if this long
const pxOf = (min: number): number => (min / 60) * HOUR

const hhmm = (d: Date): string => format(d, 'HH:mm')

/** Wall-clock minute of `day` (DST-safe, unlike adding elapsed minutes). */
const atMinute = (day: Date, m: number): Date => {
  const d = new Date(day)
  d.setHours(0, m, 0, 0)
  return d
}

const emitTimed = (day: Date, start: number, end: number): void =>
  bus.emit('event:create', {
    start: atMinute(day, start).toISOString(),
    end: atMinute(day, end).toISOString(),
    allDay: false
  })

const stop = (e: React.MouseEvent): void => e.stopPropagation()
const minutesOf = (d: Date): number => d.getHours() * 60 + d.getMinutes()
const keyOf = (e: CalEvent): string => `${e.accountId}/${e.id}`

/** Minutes of `day` an event covers, when it starts that day and ends that day (or at the next midnight). */
function sameDaySpan(e: CalEvent, day: Date): { start: number; end: number } | null {
  const b = eventBounds(e)
  if (!isSameDay(b.start, day)) return null
  if (isSameDay(b.end, day)) return { start: minutesOf(b.start), end: minutesOf(b.end) }
  return +b.end === +addDays(startOfDay(day), 1) ? { start: minutesOf(b.start), end: 1440 } : null
}

interface Props {
  days: Date[]
  events: CalEvent[]
  colorOf: ColorOf
  canDrag?: CanDrag
  moveTo?: MoveTo
}

/** An event being dragged: where it would land (day index in `days`, minutes of that day). */
interface Moving {
  key: string
  mode: 'move' | 'resize'
  day: number
  start: number
  end: number
}

export function TimeGrid({ days, events, colorOf, canDrag, moveTo }: Props): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())
  const [drag, setDrag] = useState<{ day: Date; a: number; b: number } | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  // The click that ends a drag must not also open the event.
  const justDragged = useRef(false)

  const open = (event: CalEvent) => (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    if (justDragged.current) return
    bus.emit('event:open', { event, anchor: e.currentTarget.getBoundingClientRect(), el: e.currentTarget })
  }

  /** Drag an event to another time or day (`move`), or its bottom edge to change the end (`resize`); 15-min steps. */
  const onEventDown = (e: CalEvent, dayIdx: number, mode: Moving['mode']) => (ev: React.MouseEvent<HTMLElement>) => {
    ev.stopPropagation()
    const span = sameDaySpan(e, days[dayIdx])
    if (ev.button !== 0 || !span || !moveTo || !canDrag?.(e) || !scroller.current) return
    ev.preventDefault() // no text selection while dragging
    const cols = [...scroller.current.querySelectorAll<HTMLElement>('.tg-col')]
    const minuteIn = (y: number, col: HTMLElement): number => ((y - col.getBoundingClientRect().top) / HOUR) * 60
    const x0 = ev.clientX
    const y0 = ev.clientY
    const grab = minuteIn(y0, cols[dayIdx])
    let to: Moving | null = null

    const move = (m: MouseEvent): void => {
      if (!to && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return // still a click
      let day = dayIdx
      if (mode === 'move') {
        const i = cols.findIndex((c) => {
          const r = c.getBoundingClientRect()
          return m.clientX >= r.left && m.clientX < r.right
        })
        if (i >= 0) day = i
      }
      const pointer = minuteIn(m.clientY, cols[day])
      const r = mode === 'move' ? moveRange(span.start, span.end, pointer - grab) : { start: span.start, end: resizeEnd(span.start, pointer) }
      to = { key: keyOf(e), mode, day, ...r }
      setMoving(to)
      document.body.dataset.dragging = mode
    }
    const finish = (commit: boolean): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('keydown', key, true)
      delete document.body.dataset.dragging
      setMoving(null)
      if (!to) return
      justDragged.current = true
      setTimeout(() => (justDragged.current = false))
      if (commit && (to.day !== dayIdx || to.start !== span.start || to.end !== span.end))
        moveTo(e, atMinute(days[to.day], to.start).toISOString(), atMinute(days[to.day], to.end).toISOString())
    }
    const up = (): void => finish(true)
    const key = (k: KeyboardEvent): void => {
      if (k.key !== 'Escape') return
      k.stopPropagation()
      finish(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', key, true)
  }

  // Opens on a whole hour: with today shown, the one that puts now about a third down the grid, else 08:00.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const t = new Date()
    const hours = (el.clientHeight - (el.querySelector<HTMLElement>('.tg-head')?.offsetHeight ?? 0)) / HOUR
    const top = days.some((d) => isToday(d)) ? Math.floor(t.getHours() + t.getMinutes() / 60 - hours / 3) : 8
    el.scrollTop = pxOf(Math.max(0, top) * 60) - 8
  }, []) // only on mount: later steps keep the user's scroll

  // Tick on the minute so the now-line and its clock never lag behind the real time.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = (): void => {
      setNow(new Date())
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    return () => clearTimeout(t)
  }, [])

  const minuteAt = (clientY: number, col: HTMLElement): number =>
    slotAt(((clientY - col.getBoundingClientRect().top) / HOUR) * 60)

  const onMouseDown = (day: Date) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.detail > 1) return
    const col = e.currentTarget
    const a = minuteAt(e.clientY, col)
    let b = a
    const move = (ev: MouseEvent): void => {
      b = minuteAt(ev.clientY, col)
      setDrag(b !== a ? { day, a, b } : null)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (b !== a) {
        const r = dragRange(a, b)
        emitTimed(day, r.start, r.end)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onDoubleClick = (day: Date) => (e: React.MouseEvent<HTMLDivElement>) => {
    const m = minuteAt(e.clientY, e.currentTarget)
    emitTimed(day, m, Math.min(1440, m + 60))
  }

  const nowMin = now.getHours() * 60 + now.getMinutes()
  const multi = days.length > 1
  const showsToday = days.some((d) => isToday(d))

  return (
    <div className={`tg${multi ? '' : ' tg-single'}`} ref={scroller}>
      <div className="tg-head">
        <div className="tg-row">
          <div className="tg-gutter" />
          {days.map((d) => (
            <div
              key={d.getTime()}
              className={`tg-dayhead${isToday(d) ? ' is-today' : ''}`}
              onClick={() => multi && nav.set({ view: 'day', date: d })}
            >
              <span className="dow">{format(d, 'EEE')}</span>
              <span className="num">{format(d, 'd')}</span>
            </div>
          ))}
        </div>
        <div className="tg-row tg-allday">
          <div className="tg-gutter">all-day</div>
          {days.map((d) => (
            <div
              key={d.getTime()}
              className="tg-allday-cell"
              onDoubleClick={() => bus.emit('event:create', { start: ymd(d), end: ymd(addDays(d, 1)), allDay: true })}
            >
              {eventsOnDay(events, d)
                .filter((e) => e.allDay)
                .map((e) => (
                  <div
                    key={e.id}
                    data-testid="event-block"
                    data-account-id={e.accountId}
                    className={`ev ev-allday${statusClass(e)}${isPast(e, now) ? ' is-past' : ''}`}
                    style={{ '--c': colorOf(e) } as React.CSSProperties}
                    onClick={open(e)}
                    onDoubleClick={stop}
                    {...tooltipHover(e)}
                  >
                    <span className="ev-title">{e.title}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="tg-body" style={{ height: pxOf(1440) }}>
        <div className="tg-gutter">
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <span
              key={h}
              className="tg-hour"
              // the now clock takes the place of an hour label it would overlap
              style={{ top: pxOf(h * 60), visibility: showsToday && Math.abs(nowMin - h * 60) < 12 ? 'hidden' : undefined }}
            >
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
          {showsToday && (
            <span className="tg-now-clock" data-testid="now-clock" style={{ top: pxOf(nowMin) }}>
              {hhmm(now)}
            </span>
          )}
        </div>
        {days.map((d, dayIdx) => (
          <div
            key={d.getTime()}
            className={`tg-col${isToday(d) ? ' is-today' : ''}`}
            style={{ '--hour': `${HOUR}px` } as React.CSSProperties}
            onMouseDown={onMouseDown(d)}
            onDoubleClick={onDoubleClick(d)}
          >
            {layoutDay(events, d, MIN_DUR).map(({ item: e, start, end, col, cols }) => {
              const b = eventBounds(e)
              const h = pxOf(Math.max(end - start, MIN_DUR))
              const draggable = !!moveTo && !!canDrag?.(e) && !!sameDaySpan(e, d)
              const dragged = moving?.key === keyOf(e)
              return (
                <div
                  key={e.id}
                  data-testid="event-block"
                  data-account-id={e.accountId}
                  className={`ev ev-timed${statusClass(e)}${isPast(e, now) ? ' is-past' : ''}${h < 34 ? ' is-short' : ''}${draggable ? ' is-draggable' : ''}${dragged ? ' is-dragged' : ''}`}
                  style={
                    {
                      '--c': colorOf(e),
                      top: pxOf(start),
                      height: h - 1,
                      left: `calc(${(col / cols) * 100}% + 1px)`,
                      width: `calc(${100 / cols}% - 3px)`
                    } as React.CSSProperties
                  }
                  title={meetingUrl(e.location) ? undefined : `${e.title}\n${hhmm(b.start)} – ${hhmm(b.end)}`}
                  onMouseDown={onEventDown(e, dayIdx, 'move')}
                  onDoubleClick={stop}
                  onClick={open(e)}
                  {...tooltipHover(e)}
                >
                  <span className="ev-title">{e.title}</span>
                  <span className="ev-meta">
                    {hhmm(b.start)}
                    {e.location ? ` · ${place(e.location)}` : ''}
                  </span>
                  {draggable && (
                    <span className="ev-resize" data-testid="event-resize" aria-hidden onMouseDown={onEventDown(e, dayIdx, 'resize')} onClick={stop} />
                  )}
                </div>
              )
            })}
            {moving?.day === dayIdx &&
              (() => {
                const e = events.find((x) => keyOf(x) === moving.key)
                if (!e) return null
                return (
                  <div
                    className="ev ev-timed ev-preview"
                    data-testid="drag-preview"
                    style={
                      {
                        '--c': colorOf(e),
                        top: pxOf(moving.start),
                        height: pxOf(Math.max(moving.end - moving.start, MIN_DUR)) - 1,
                        left: 1,
                        width: 'calc(100% - 3px)'
                      } as React.CSSProperties
                    }
                  >
                    <span className="ev-title">{e.title}</span>
                    <span className="ev-meta">
                      {hhmm(atMinute(d, moving.start))} – {hhmm(atMinute(d, moving.end))}
                    </span>
                  </div>
                )
              })()}
            {drag && isSameDay(drag.day, d) && (() => {
              const r = dragRange(drag.a, drag.b)
              return (
                <div className="tg-ghost" style={{ top: pxOf(r.start), height: pxOf(r.end - r.start) }}>
                  {hhmm(atMinute(d, r.start))} – {hhmm(atMinute(d, r.end))}
                </div>
              )
            })()}
            {isToday(d) ? (
              <div className="tg-now" style={{ top: pxOf(nowMin) }}>
                <span className="tg-now-dot" />
              </div>
            ) : (
              // the same time on the other days of the view, faint
              showsToday && <div className="tg-now is-faint" style={{ top: pxOf(nowMin) }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
