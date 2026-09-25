import { useEffect, useRef, useState } from 'react'
import { addDays, differenceInCalendarDays, format, isSameMonth, isToday } from 'date-fns'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { tooltipHover } from '../components/EventTooltip'
import { nav } from './nav'
import { eventBounds, eventsOnDay, isPast, monthGrid, statusClass, ymd } from '@mysticals/core/logic/layout'
import type { CanDrag, ColorOf, MoveTo } from './CalendarView'
import { shiftDays } from './drag'

const MAX_PER_DAY = 3

interface Props {
  date: Date
  events: CalEvent[]
  colorOf: ColorOf
  canDrag?: CanDrag
  moveTo?: MoveTo
}

const keyOf = (e: CalEvent): string => `${e.accountId}/${e.id}`

export function MonthGrid({ date, events, colorOf, canDrag, moveTo }: Props): React.JSX.Element {
  const days = monthGrid(date)
  const [now, setNow] = useState(() => new Date())
  // Dragging an event to another day: its key and the cell (index in `days`) under the pointer.
  const [moving, setMoving] = useState<{ key: string; over: number } | null>(null)
  const justDragged = useRef(false)

  const onEventDown = (e: CalEvent, from: number) => (ev: React.MouseEvent<HTMLElement>) => {
    if (ev.button !== 0 || !moveTo || !canDrag?.(e)) return
    ev.preventDefault()
    const x0 = ev.clientX
    const y0 = ev.clientY
    let over: number | null = null
    const move = (m: MouseEvent): void => {
      if (over === null && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return
      const cell = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>('.mg-cell')
      over = cell ? Number(cell.dataset.idx) : (over ?? from)
      setMoving({ key: keyOf(e), over })
      document.body.dataset.dragging = 'move'
    }
    const finish = (commit: boolean): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('keydown', key, true)
      delete document.body.dataset.dragging
      setMoving(null)
      if (over === null) return
      justDragged.current = true
      setTimeout(() => (justDragged.current = false))
      const delta = differenceInCalendarDays(days[over], days[from])
      if (commit && delta) {
        const to = shiftDays(e, delta)
        moveTo(e, to.start, to.end)
      }
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
  const dragged = moving && events.find((e) => keyOf(e) === moving.key)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="mg">
      <div className="mg-dows">
        {days.slice(0, 7).map((d) => (
          <div key={d.getTime()}>{format(d, 'EEE')}</div>
        ))}
      </div>
      <div className="mg-grid">
        {days.map((d, idx) => {
          const list = eventsOnDay(events, d)
          const shown = list.length > MAX_PER_DAY ? list.slice(0, MAX_PER_DAY - 1) : list
          const more = list.length - shown.length
          return (
            <div
              key={d.getTime()}
              data-idx={idx}
              className={`mg-cell${isSameMonth(d, date) ? '' : ' is-other'}${isToday(d) ? ' is-today' : ''}${moving?.over === idx ? ' is-drop' : ''}`}
              onDoubleClick={() => bus.emit('event:create', { start: ymd(d), end: ymd(addDays(d, 1)), allDay: true })}
            >
              <div className="mg-num">
                <span>{format(d, 'd') === '1' ? format(d, 'd MMM') : format(d, 'd')}</span>
              </div>
              {shown.map((e) => (
                <div
                  key={e.id}
                  data-testid="event-block"
                  data-account-id={e.accountId}
                  className={`ev mg-ev${e.allDay ? ' ev-allday' : ''}${statusClass(e)}${isPast(e, now) ? ' is-past' : ''}${moving?.key === keyOf(e) ? ' is-dragged' : ''}`}
                  style={{ '--c': colorOf(e) } as React.CSSProperties}
                  onMouseDown={onEventDown(e, idx)}
                  onDoubleClick={(ev) => ev.stopPropagation()}
                  onClick={(ev) =>
                    !justDragged.current &&
                    bus.emit('event:open', { event: e, anchor: ev.currentTarget.getBoundingClientRect(), el: ev.currentTarget })
                  }
                  {...tooltipHover(e)}
                >
                  {!e.allDay && <span className="mg-dot" />}
                  <span className="ev-title">{e.title}</span>
                  {!e.allDay && <span className="mg-time">{format(eventBounds(e).start, 'HH:mm')}</span>}
                </div>
              ))}
              {dragged && moving.over === idx && (
                <div className={`ev mg-ev ev-preview${dragged.allDay ? ' ev-allday' : ''}`} data-testid="drag-preview" style={{ '--c': colorOf(dragged) } as React.CSSProperties}>
                  {!dragged.allDay && <span className="mg-dot" />}
                  <span className="ev-title">{dragged.title}</span>
                </div>
              )}
              {more > 0 && (
                <button className="mg-more" onClick={() => nav.set({ view: 'day', date: d })}>
                  +{more} more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
