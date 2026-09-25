import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, getISOWeek } from 'date-fns'
import type { CalEvent } from '@shared/types'
import type { MenuCommand } from '@shared/ipc'
import { useCalendarData } from '../hooks/useCalendarData'
import { visibleEvents } from '@mysticals/core/logic/visible'
import { canEdit } from '@mysticals/core/logic/details'
import { errorText } from '@mysticals/core/logic/editor'
import { bus } from '../bus'
import { nav, useNav } from './nav'
import { rangeLabel, shiftDate, viewDays, viewRange, type View } from '@mysticals/core/logic/layout'
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
/** Drag-and-drop from the grids: the event's new start/end (same format as the event's own). */
export type MoveTo = (e: CalEvent, start: string, end: string) => void
export type CanDrag = (e: CalEvent) => boolean

const keyOf = (e: Pick<CalEvent, 'accountId' | 'id'>): string => `${e.accountId}/${e.id}`
const same = (a: string, b: string): boolean => Date.parse(a) === Date.parse(b) || a === b

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
  // Dropped events show at their new time at once; an entry goes when the data has caught up or the save fails.
  const [moved, setMoved] = useState<Map<string, { start: string; end: string }>>(() => new Map())
  const events = useMemo(() => {
    const shown = visibleEvents(all, calendars)
    return moved.size ? shown.map((e) => ({ ...e, ...moved.get(keyOf(e)) })) : shown
  }, [all, calendars, moved])
  useEffect(() => {
    setMoved((m) => {
      if (!m.size) return m
      const caught = [...m].filter(([k, to]) => {
        const e = all.find((x) => keyOf(x) === k)
        return !e || (same(e.start, to.start) && same(e.end, to.end))
      })
      if (!caught.length) return m
      const next = new Map(m)
      for (const [k] of caught) next.delete(k)
      return next
    })
  }, [all])

  const canDrag = useCallback<CanDrag>(
    (e) =>
      canEdit(
        e,
        accounts.find((a) => a.id === e.accountId),
        calendars.find((c) => c.accountId === e.accountId && c.id === e.calendarId)
      ),
    [accounts, calendars]
  )

  const moveTo = useCallback<MoveTo>((e, start, end) => {
    const k = keyOf(e)
    const drop = (): void =>
      setMoved((m) => {
        const next = new Map(m)
        next.delete(k)
        return next
      })
    setMoved((m) => new Map(m).set(k, { start, end }))
    window.api.events.update({ ...e, start, end }).then(
      () =>
        bus.emit('toast', {
          text: `Moved “${e.title || 'Untitled'}”`,
          // Undo is just the reverse move.
          action: { label: 'Undo', run: () => moveTo({ ...e, start, end }, e.start, e.end) }
        }),
      (err) => {
        drop()
        bus.emit('toast', { text: `Couldn't move “${e.title || 'Untitled'}”: ${errorText(err)}`, error: true })
      }
    )
  }, [])
  const firstSync = accounts.filter((a) => a.syncing && !a.synced)

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
        {/* Keyed by the period so a step to the next one fades the new title in. */}
        <h1 className="toolbar-title" key={`${view}/${format(days[0], 'yyyy-MM-dd')}`}>
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
        <button className="new-btn" data-testid="new-event" title="New event (N)" onClick={() => bus.emit('event:create', {})}>
          + new
        </button>
      </header>
      {firstSync.length > 0 && <div className="loadbar" role="progressbar" aria-label="Syncing" data-testid="loadbar" />}
      {view === 'month' ? (
        <MonthGrid date={date} events={events} colorOf={colorOf} canDrag={canDrag} moveTo={moveTo} />
      ) : (
        <TimeGrid days={days} events={events} colorOf={colorOf} canDrag={canDrag} moveTo={moveTo} />
      )}
      {firstSync.length > 0 && !events.length && (
        <div className="first-sync" role="status" data-testid="first-sync">
          <div className="app-loader-term">
            <div><span className="app-loader-prompt">~ $</span> mysticals --sync</div>
            <div className="app-loader-spin">first sync of {firstSync.map((a) => a.label).join(', ')}…</div>
          </div>
        </div>
      )}
    </div>
  )
}
