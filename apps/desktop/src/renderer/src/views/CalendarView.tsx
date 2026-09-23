import { useEffect, useMemo } from 'react'
import { format, getISOWeek } from 'date-fns'
import type { CalEvent } from '@shared/types'
import type { MenuCommand } from '@shared/ipc'
import { useCalendarData, visibleEvents } from '../hooks/useCalendarData'
import { bus } from '../bus'
import { nav, useNav } from './nav'
import { rangeLabel, shiftDate, viewDays, viewRange, type View } from './layout'
import { TimeGrid } from './TimeGrid'
import { MonthGrid } from './MonthGrid'

const VIEWS: View[] = ['day', '3day', 'week', 'month']
const LABEL: Record<View, string> = { day: 'Day', '3day': '3 Days', week: 'Week', month: 'Month' }
const KEY_VIEW: Record<string, View> = { d: 'day', '3': '3day', w: 'week', m: 'month' }
const MENU_VIEW: Partial<Record<MenuCommand, View>> = {
  'view-day': 'day',
  'view-3day': '3day',
  'view-week': 'week',
  'view-month': 'month'
}

export type ColorOf = (e: CalEvent) => string

const go = (dir: 1 | -1): void => {
  const { view, date } = nav.get()
  nav.set({ date: shiftDate(view, date, dir) })
}
const today = (): void => nav.set({ date: new Date() })

export function CalendarView(): React.JSX.Element {
  const { date, view } = useNav()
  const range = useMemo(() => viewRange(view, date), [view, date])
  const days = useMemo(() => viewDays(view, date), [view, date])
  const { accounts, calendars, events: all } = useCalendarData(range)
  const events = useMemo(() => visibleEvents(all, calendars), [all, calendars])

  const colorOf = useMemo<ColorOf>(() => {
    const cal = new Map(calendars.map((c) => [`${c.accountId}/${c.id}`, c.color]))
    const acc = new Map(accounts.map((a) => [a.id, a.color]))
    return (e) => cal.get(`${e.accountId}/${e.calendarId}`) ?? acc.get(e.accountId) ?? '#6272a4'
  }, [accounts, calendars])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      const typing =
        t.closest('textarea, select, [contenteditable="true"]') ||
        (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(t.type))
      if (e.metaKey || e.ctrlKey || e.altKey || typing) return
      // Keys belong to the open sheet/popover, not the grid.
      if (document.querySelector('dialog[open], .mc-overlay, [data-testid="details"]')) return
      const k = e.key
      if (k === 'ArrowLeft' || k === 'h') go(-1)
      else if (k === 'ArrowRight' || k === 'l') go(1)
      else if (k === 't' || k === 'T') today()
      else if (KEY_VIEW[k]) nav.set({ view: KEY_VIEW[k] })
      else if (k === 'j' || k === 'k') document.querySelector('.tg')?.scrollBy({ top: k === 'j' ? 48 : -48 })
      else if (k === 'n') bus.emit('event:create', {})
      else if (k === 'i') bus.emit('invites:open', {})
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const offMenu = window.api.onMenu((cmd) => {
      if (cmd === 'today') today()
      const v = MENU_VIEW[cmd]
      if (v) nav.set({ view: v })
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      offMenu()
    }
  }, [])

  return (
    <div className="calendar-view" data-testid="calendar-view">
      <header className="toolbar">
        <h1 className="toolbar-title">
          {view === 'day' ? format(date, 'd MMMM') : view === '3day' ? rangeLabel(days[0], days[2]) : format(date, 'MMMM')}
          <span className="toolbar-sub">
            {view !== '3day' && format(date, 'yyyy')}
            {view === 'day' && ` · ${format(date, 'EEE')}`}
            {view === '3day' &&
              [...new Set(days.map((d) => `W${getISOWeek(d)}`))].join('–')}
            {(view === 'day' || view === 'week') && ` · W${getISOWeek(date)}`}
          </span>
        </h1>
        <div className="seg" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={v === view}
              className={v === view ? 'active' : ''}
              data-testid={`view-switch-${v}`}
              onClick={() => nav.set({ view: v })}
            >
              {LABEL[v]}
            </button>
          ))}
        </div>
        <div className="toolbar-nav">
          <button className="icon-btn" aria-label="Previous" onClick={() => go(-1)}>
            ‹
          </button>
          <button className="today-btn" onClick={today}>
            today
          </button>
          <button className="icon-btn" aria-label="Next" onClick={() => go(1)}>
            ›
          </button>
        </div>
      </header>
      {view === 'month' ? (
        <MonthGrid date={date} events={events} colorOf={colorOf} />
      ) : (
        <TimeGrid days={days} events={events} colorOf={colorOf} />
      )}
    </div>
  )
}
