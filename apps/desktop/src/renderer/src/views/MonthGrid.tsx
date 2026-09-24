import { useEffect, useState } from 'react'
import { addDays, format, isSameMonth, isToday } from 'date-fns'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { tooltipHover } from '../components/EventTooltip'
import { nav } from './nav'
import { eventBounds, eventsOnDay, isPast, monthGrid, statusClass, ymd } from '@mysticals/core/logic/layout'
import type { ColorOf } from './CalendarView'

const MAX_PER_DAY = 3

interface Props {
  date: Date
  events: CalEvent[]
  colorOf: ColorOf
}

export function MonthGrid({ date, events, colorOf }: Props): React.JSX.Element {
  const days = monthGrid(date)
  const [now, setNow] = useState(() => new Date())
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
        {days.map((d) => {
          const list = eventsOnDay(events, d)
          const shown = list.length > MAX_PER_DAY ? list.slice(0, MAX_PER_DAY - 1) : list
          const more = list.length - shown.length
          return (
            <div
              key={d.getTime()}
              className={`mg-cell${isSameMonth(d, date) ? '' : ' is-other'}${isToday(d) ? ' is-today' : ''}`}
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
                  className={`ev mg-ev${e.allDay ? ' ev-allday' : ''}${statusClass(e)}${isPast(e, now) ? ' is-past' : ''}`}
                  style={{ '--c': colorOf(e) } as React.CSSProperties}
                  onDoubleClick={(ev) => ev.stopPropagation()}
                  onClick={(ev) => bus.emit('event:open', { event: e, anchor: ev.currentTarget.getBoundingClientRect() })}
                  {...tooltipHover(e)}
                >
                  {!e.allDay && <span className="mg-dot" />}
                  <span className="ev-title">{e.title}</span>
                  {!e.allDay && <span className="mg-time">{format(eventBounds(e).start, 'HH:mm')}</span>}
                </div>
              ))}
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
