import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, format, isSameDay, isToday, startOfDay } from 'date-fns'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { tooltipHover } from '../components/EventTooltip'
import { eventButton, eventMenu, slotMenu } from '../components/EventMenu'
import { eventPlace } from '@mysticals/core/logic/meeting'
import { nav } from './nav'
import { dragRange, eventBounds, eventsOnDay, fitColumns, isPast, layoutDayLong, slotAt, statusClass, ymd } from '@mysticals/core/logic/layout'
import type { CanDrag, ColorOf, MoveTo } from './CalendarView'
import { moveRange, resizeEnd, resizeStart } from './drag'
import { currentLocale, fmt, t } from '../i18n'
import { useLongEvents } from '../longEvents'

const HOUR = 48 // px per hour
const MAX_ALLDAY = 3 // all-day events per day before the row collapses
const MIN_DUR = 22 // minutes; shorter events render (and pack) as if this long
const RAIL = 8 // px per rail lane (6px bar + gap) for long events in rails mode
const CASCADE = 14 // px each overlapping block steps right in cascade mode
const MIN_BLOCK = 48 // px; side-by-side blocks any narrower fold into a "+N"
const pxOf = (min: number): number => (min / 60) * HOUR

/** Left and width of a block in column `col` of `cols`, `span` columns wide, right of `inset` rail lanes. */
const beside = (col: number, cols: number, span: number, inset: number): React.CSSProperties => ({
  left: `calc(${inset * RAIL}px + (100% - ${inset * RAIL}px) * ${col / cols} + 1px)`,
  width: `calc((100% - ${inset * RAIL}px) * ${span / cols} - 3px)`
})

const hhmm = (d: Date): string => format(d, 'HH:mm')
/** "10–23", "9:30–20": the hours a long event covers on a day, for its all-day chip. */
const hourSpan = (a: number, b: number): string => {
  const h = (m: number): string => (m % 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : String(m / 60))
  return `${h(a)}–${h(b)}`
}

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
  /** Bumped by "today": scroll back to now. */
  todays?: number
}

/** An event being dragged: where it would land (day index in `days`, minutes of that day). */
interface Moving {
  key: string
  mode: 'move' | 'resize' | 'resize-start'
  day: number
  start: number
  end: number
}

export function TimeGrid({ days, events, colorOf, canDrag, moveTo, todays }: Props): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // Width of the day columns together, for how many blocks fit side by side.
  const [area, setArea] = useState(Infinity)
  const [now, setNow] = useState(() => new Date())
  const [drag, setDrag] = useState<{ day: Date; a: number; b: number } | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  const [allDayOpen, setAllDayOpen] = useState(false)
  const long = useLongEvents()
  // The click that ends a drag must not also open the event.
  const justDragged = useRef(false)

  const open = (event: CalEvent) => (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    if (justDragged.current) return
    bus.emit('event:open', { event, anchor: e.currentTarget.getBoundingClientRect(), el: e.currentTarget })
  }

  /** Drag an event to another time or day (`move`), or its bottom/top edge to change the end (`resize`) / start (`resize-start`); 15-min steps. */
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
      const r =
        mode === 'move'
          ? moveRange(span.start, span.end, pointer - grab)
          : mode === 'resize'
            ? { start: span.start, end: resizeEnd(span.start, pointer) }
            : { start: resizeStart(span.end, pointer), end: span.end }
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

  // Opens (and returns on "today") on a whole hour: with today shown, the one that puts now about a third down the grid, else 08:00.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const t = new Date()
    const hours = (el.clientHeight - (el.querySelector<HTMLElement>('.tg-head')?.offsetHeight ?? 0)) / HOUR
    const top = days.some((d) => isToday(d)) ? Math.floor(t.getHours() + t.getMinutes() / 60 - hours / 3) : 8
    el.scrollTop = pxOf(Math.max(0, top) * 60) - 8
  }, [todays]) // not on ‹ › steps: they keep the user's scroll

  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const measure = (): void => setArea(el.clientWidth - (el.querySelector<HTMLElement>('.tg-gutter')?.offsetWidth ?? 0))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
  const layouts = days.map((d) => layoutDayLong(events, d, MIN_DUR, long))
  // Side by side, as many columns as stay MIN_BLOCK wide (at least one beside the "+N"); the "+N" opens the day, which
  // never folds: there it would lead nowhere.
  const fits = layouts.map((l) => (multi ? Math.max(2, Math.floor((area / days.length - RAIL * Math.max(0, ...l.timed.map((p) => p.inset))) / MIN_BLOCK)) : Infinity))
  const fitted = layouts.map((l, i) => fitColumns(l.timed, fits[i], MIN_DUR))
  // One Tab stop per day column, its earliest event; ↑/↓ reach the others.
  const firsts = layouts.map((l, i) => [...l.rails, ...fitted[i].shown].sort((a, b) => a.start - b.start)[0]?.item)
  /** All-day events, then long timed ones moved up (all-day mode) with their hours as a tag. */
  const allDayOf = (i: number): { e: CalEvent; tag?: string }[] => [
    ...eventsOnDay(events, days[i]).filter((e) => e.allDay).map((e) => ({ e })),
    ...layouts[i].allDay.map((x) => ({ e: x.item, tag: hourSpan(x.start, x.end) }))
  ]
  const allDayOverflows = days.some((_, i) => allDayOf(i).length > MAX_ALLDAY)
  // Multi-day views: a day's header switches to that day.
  const DayHead = multi ? 'button' : 'div'

  return (
    <div className={`tg${multi ? '' : ' tg-single'}`} ref={scroller}>
      <div className="tg-head">
        <div className="tg-row">
          <div className="tg-gutter" />
          {days.map((d) => (
            <DayHead
              key={d.getTime()}
              type={multi ? 'button' : undefined}
              className={`tg-dayhead${isToday(d) ? ' is-today' : ''}`}
              onClick={() => multi && nav.set({ view: 'day', date: d })}
            >
              <span className="dow">{fmt(d, 'EEE')}</span>
              <span className="num">{format(d, 'd')}</span>
            </DayHead>
          ))}
        </div>
        <div className="tg-row tg-allday">
          <div className="tg-gutter">
            {t('grid.allDay')}
            {allDayOpen && allDayOverflows && (
              <button className="tg-allday-toggle" aria-label={t('grid.collapseAllDay')} onClick={() => setAllDayOpen(false)}>
                ▴
              </button>
            )}
          </div>
          {days.map((d, i) => {
            const list = allDayOf(i)
            const more = allDayOpen ? 0 : Math.max(0, list.length - MAX_ALLDAY)
            return (
              <div
                key={d.getTime()}
                className="tg-allday-cell"
                onDoubleClick={() => bus.emit('event:create', { start: ymd(d), end: ymd(addDays(d, 1)), allDay: true })}
                {...slotMenu(() => ({ slot: { start: ymd(d), allDay: true }, end: ymd(addDays(d, 1)) }))}
              >
                {list
                  .slice(0, list.length - more)
                  .map(({ e, tag }, n) => (
                    <div
                      key={e.id}
                      data-testid="event-block"
                      data-account-id={e.accountId}
                      className={`ev ev-allday${tag ? ' is-promoted' : ''}${statusClass(e)}${isPast(e, now) ? ' is-past' : ''}`}
                      style={{ '--c': colorOf(e) } as React.CSSProperties}
                      onClick={open(e)}
                      onDoubleClick={stop}
                      {...eventButton(e, n === 0)}
                      {...tooltipHover(e)}
                      {...eventMenu(e)}
                    >
                      {tag && <span className="ev-hours">{tag}</span>}
                      <span className="ev-title">{e.title}</span>
                    </div>
                  ))}
                {more > 0 && (
                  <button
                    className="tg-allday-toggle"
                    aria-label={t('grid.showMoreAllDay', { n: more })}
                    onClick={() => setAllDayOpen(true)}
                    onDoubleClick={stop}
                  >
                    +{more}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="tg-body" style={{ height: pxOf(1440) }} ref={body}>
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
            {...slotMenu((e) => {
              const m = minuteAt(e.clientY, e.currentTarget)
              return { slot: { start: atMinute(d, m).toISOString(), allDay: false }, end: atMinute(d, Math.min(1440, m + 60)).toISOString() }
            })}
          >
            {layouts[dayIdx].busy.map((b) => (
              <div
                key={b.start}
                className={`tg-busy${long.mode === 'allday' ? ' is-capped' : ''}`}
                data-testid="busy-band"
                style={{ top: pxOf(b.start), height: pxOf(b.end - b.start) }}
              />
            ))}
            {layouts[dayIdx].rails.map(({ item: e, start, end, col }) => (
              <div
                key={e.id}
                data-testid="event-rail"
                data-account-id={e.accountId}
                className={`ev-rail${statusClass(e)}${isPast(e, now) ? ' is-past' : ''}`}
                style={{ '--c': colorOf(e), top: pxOf(start), height: pxOf(end - start) - 1, left: 2 + col * RAIL } as React.CSSProperties}
                onMouseDown={stop}
                onDoubleClick={stop}
                onClick={open(e)}
                {...eventButton(e, e === firsts[dayIdx])}
                {...tooltipHover(e)}
                {...eventMenu(e)}
              />
            ))}
            {fitted[dayIdx].shown.map(({ item: e, start, end, col, cols, span, inset, level }, order) => {
              const b = eventBounds(e)
              const h = pxOf(Math.max(end - start, MIN_DUR))
              const short = h < 34
              const draggable = !!moveTo && !!canDrag?.(e) && !!sameDaySpan(e, d)
              const dragged = moving?.key === keyOf(e)
              // cascade: full width less a step per overlapped block, painted in order (later on top)
              const indent = level === undefined ? null : `min(${level * CASCADE}px, 45%)`
              return (
                <div
                  key={e.id}
                  data-testid="event-block"
                  data-account-id={e.accountId}
                  className={`ev ev-timed${indent ? ' is-cascade' : ''}${statusClass(e)}${isPast(e, now) ? ' is-past' : ''}${short ? ' is-short' : ''}${draggable ? ' is-draggable' : ''}${dragged ? ' is-dragged' : ''}`}
                  style={
                    {
                      '--c': colorOf(e),
                      top: pxOf(start),
                      height: h - 1,
                      ...(indent
                        ? ({ left: `calc(${indent} + 1px)`, width: `calc(100% - ${indent} - 3px)`, '--z': order + 1 } as React.CSSProperties)
                        : beside(col, cols, span, inset))
                    } as React.CSSProperties
                  }
                  onMouseDown={onEventDown(e, dayIdx, 'move')}
                  onDoubleClick={stop}
                  onClick={open(e)}
                  {...eventButton(e, e === firsts[dayIdx])}
                  {...tooltipHover(e)}
                  {...eventMenu(e)}
                >
                  <span className="ev-title">{e.title}</span>
                  <span className="ev-meta">
                    {hhmm(b.start)}
                    {/* a one-line (is-short) block keeps its room for the title */}
                    {!short && eventPlace(e, currentLocale()) ? ` · ${eventPlace(e, currentLocale())}` : ''}
                  </span>
                  {draggable && (
                    <>
                      <span className="ev-resize ev-resize-top" data-testid="event-resize-top" aria-hidden onMouseDown={onEventDown(e, dayIdx, 'resize-start')} onClick={stop} />
                      <span className="ev-resize" data-testid="event-resize" aria-hidden onMouseDown={onEventDown(e, dayIdx, 'resize')} onClick={stop} />
                    </>
                  )}
                </div>
              )
            })}
            {fitted[dayIdx].more.map(({ start, end, items }) => (
              <button
                key={start}
                type="button"
                className="tg-more"
                data-testid="more-events"
                aria-label={t('grid.showMore', { n: items.length })}
                style={{ top: pxOf(start), height: pxOf(end - start) - 1, ...beside(fits[dayIdx] - 1, fits[dayIdx], 1, Math.max(...items.map((p) => p.inset))) }}
                onMouseDown={stop}
                onDoubleClick={stop}
                onClick={() => nav.set({ view: 'day', date: d })}
              >
                +{items.length}
              </button>
            ))}
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
