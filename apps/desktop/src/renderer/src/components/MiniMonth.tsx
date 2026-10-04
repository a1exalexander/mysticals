import { useEffect, useState } from 'react'
import { addMonths, format, isSameDay, isSameMonth, isToday, startOfMonth } from 'date-fns'
import { nav, useNav } from '../views/nav'
import { monthGrid } from '@mysticals/core/logic/layout'
import { fmt, t, useLocale } from '../i18n'

/** Sidebar month picker; clicking a day navigates the main view. */
export function MiniMonth(): React.JSX.Element {
  const { date } = useNav()
  useLocale()
  const [shown, setShown] = useState(() => startOfMonth(date))
  const monthKey = startOfMonth(date).getTime()
  useEffect(() => setShown(new Date(monthKey)), [monthKey])

  const days = monthGrid(shown)
  return (
    <div className="mini">
      <div className="mini-head">
        <span className="mini-title">{fmt(shown, 'LLLL yyyy')}</span>
        <button className="mini-arrow" aria-label={t('mini.prev')} onClick={() => setShown(addMonths(shown, -1))}>
          ‹
        </button>
        <button className="mini-arrow" aria-label={t('mini.next')} onClick={() => setShown(addMonths(shown, 1))}>
          ›
        </button>
      </div>
      <div className="mini-grid">
        {days.slice(0, 7).map((d) => (
          <span key={`h${d.getTime()}`} className="mini-dow">
            {fmt(d, 'EEEEE')}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d.getTime()}
            className={[
              'mini-day',
              !isSameMonth(d, shown) && 'is-other',
              isToday(d) && 'is-today',
              isSameDay(d, date) && 'is-selected'
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => nav.set({ date: d })}
          >
            {format(d, 'd')}
          </button>
        ))}
      </div>
    </div>
  )
}
