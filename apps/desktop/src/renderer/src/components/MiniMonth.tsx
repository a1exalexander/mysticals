import { useEffect, useRef, useState } from 'react'
import { addDays, addMonths, format, isSameDay, isSameMonth, isToday, startOfMonth } from 'date-fns'
import { nav, useNav } from '../views/nav'
import { monthGrid, viewDays } from '@mysticals/core/logic/layout'
import { cap, fmt, t, useLocale } from '../i18n'

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

/** Sidebar month picker; clicking a day navigates the main view. One tab stop, arrow keys move between days. */
export function MiniMonth(): React.JSX.Element {
  const { date, view } = useNav()
  useLocale()
  const [shown, setShown] = useState(() => startOfMonth(date))
  const monthKey = startOfMonth(date).getTime()
  useEffect(() => setShown(new Date(monthKey)), [monthKey])
  // The keyboard-focused day (the grid's one tab stop); follows the selected day.
  const [focus, setFocus] = useState(date)
  // Set when DOM focus should move to the new tab stop: after a key press here, or when the selected day changes
  // (h/l/t) while focus is in the grid. Paging months re-renders the old day away, dropping focus to <body>.
  const moved = useRef(false)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    moved.current = grid.current?.contains(document.activeElement) ?? false
    setFocus(date)
  }, [date])
  useEffect(() => {
    if (moved.current) grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
    moved.current = false
  }, [focus])

  const days = monthGrid(shown)
  // ‹ › may page away from the focused day: the month's first day takes the tab stop then.
  const stop = isSameMonth(focus, shown) ? focus : shown
  // The days the main view shows; the month view is this whole grid, so it tints nothing.
  const range = view === 'month' ? [] : viewDays(view === 'agenda' ? 'day' : view, date)
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // The button's own click selects the day; no window shortcut should see the key too.
    if (e.key === 'Enter' || e.key === ' ') return e.stopPropagation()
    const i = days.findIndex((d) => isSameDay(d, stop))
    const k = e.key
    const next =
      k in STEP ? addDays(stop, STEP[k])
      : k === 'Home' ? days[i - (i % 7)]
      : k === 'End' ? days[i - (i % 7) + 6]
      : k === 'PageUp' || k === 'PageDown' ? addMonths(stop, k === 'PageUp' ? -1 : 1)
      : null
    if (!next) return
    // Arrows here move the focus, not the main view (CalendarView listens on window).
    e.preventDefault()
    e.stopPropagation()
    moved.current = true
    setFocus(next)
    if (!isSameMonth(next, shown)) setShown(startOfMonth(next))
  }
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
      <div className="mini-grid" ref={grid} onKeyDown={onKey}>
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
              range.some((r) => isSameDay(r, d)) && 'in-range',
              isToday(d) && 'is-today',
              isSameDay(d, date) && 'is-selected'
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={cap(fmt(d, 'EEEE, d MMMM yyyy'))}
            aria-current={isToday(d) ? 'date' : undefined}
            aria-pressed={isSameDay(d, date)}
            tabIndex={isSameDay(d, stop) ? 0 : -1}
            onClick={() => nav.set({ date: d })}
          >
            {format(d, 'd')}
          </button>
        ))}
      </div>
    </div>
  )
}
