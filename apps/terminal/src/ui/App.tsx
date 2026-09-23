import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Text, useApp, useStdin } from 'ink'
import { addDays, differenceInMinutes, format, isSameMonth, max, set, startOfDay } from 'date-fns'
import { eventBounds, eventsOnDay, rangeLabel, viewDays } from '@multicals/core/logic/layout'
import { errorText } from '@multicals/core/logic/editor'
import type { CalEvent } from '@multicals/core/shared/types'
import { AGENDA_DAYS, eventKey, navRange, useApi, useDirectory, useEvents, useNav, useNow, useTermSize, type Nav, type View, type ViewProps } from './hooks'
import { Clickable, MouseProvider, useKeys } from './mouse'
import { C } from './theme'
import { Agenda } from './views/Agenda'
import { Day, TwoDay } from './views/Day'
import { Week } from './views/Week'
import { Month } from './views/Month'
import { EventDetails, EventInfo } from './screens/EventDetails'
import { EventEditor } from './screens/EventEditor'
import { Accounts } from './screens/Accounts'
import { Invites } from './screens/Invites'
import { StatusLine } from './StatusLine'

/** At most one overlay at a time; while open it owns all keyboard input. */
export type Overlay =
  | { kind: 'details'; event: CalEvent }
  | { kind: 'editor'; event?: CalEvent; initialStart?: Date }
  | { kind: 'accounts' }
  | { kind: 'invites' }
  | { kind: 'help' }

const VIEWS: Record<View, (p: ViewProps) => ReactNode> = { agenda: Agenda, day: Day, '2day': TwoDay, week: Week, month: Month }
const VIEW_KEYS: Record<string, View> = { a: 'agenda', d: 'day', '2': '2day', w: 'week', m: 'month' }
const VIEW_LABEL: Record<View, string> = { agenda: 'Agenda', day: 'Day', '2day': '2 Days', week: 'Week', month: 'Month' }

const HELP: [string, string][] = [
  ['a d 2 w m', 'agenda / day / 2 days / week / month'],
  ['← →', 'previous / next day (agenda: event); also h l'],
  ['↑ ↓', 'previous / next event of the day (month: week)'],
  ['j k', 'next / previous event'],
  ['⇧← ⇧→', 'previous / next page (also H L)'],
  ['t', 'today'],
  ['enter', 'open selected event'],
  ['n', 'new event'],
  ['i', 'invites'],
  ['s', 'accounts & calendars'],
  ['r', 'sync now'],
  ['?', 'this help'],
  ['q', 'quit'],
  ['click', 'tabs, buttons, events (click again to open), day headers'],
  ['wheel', 'select next / previous event'],
  ['⌥ drag', 'select text (Shift in some terminals)']
]

function Help({ onClose }: { onClose(): void }) {
  useKeys(() => onClose())
  return (
    <Clickable flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} onClick={onClose}>
      <Text bold color={C.accent}>Keys</Text>
      {HELP.map(([k, d]) => (
        <Text key={k}>
          <Text color={C.cyan}>{k.padEnd(10)}</Text> {d}
        </Text>
      ))}
      <Text color={C.muted}>any key or click to close</Text>
    </Clickable>
  )
}

const TABS: View[] = ['agenda', 'day', '2day', 'week', 'month']
/** Preview pane beside agenda/day/2day when the terminal is at least this wide. */
const PANE_MIN_WIDTH = 100

function Header({ nav, width, onView, onShift, onToday }: {
  nav: Nav
  width: number
  onView(v: View): void
  onShift(dir: 1 | -1): void
  onToday(): void
}) {
  return (
    <Box width={width} height={1} overflow="hidden">
      {TABS.map((v) => (
        <Clickable key={v} flexShrink={0} onClick={() => onView(v)}>
          <Text inverse={v === nav.view} color={v === nav.view ? C.accent : C.muted} bold={v === nav.view}>
            {` ${VIEW_LABEL[v]} `}
          </Text>
        </Clickable>
      ))}
      <Box flexShrink={0} marginX={1}>
        <Clickable onClick={() => onShift(-1)}>
          <Text color={C.cyan}>{' ‹ '}</Text>
        </Clickable>
        <Clickable onClick={onToday}>
          <Text color={C.muted}>today</Text>
        </Clickable>
        <Clickable onClick={() => onShift(1)}>
          <Text color={C.cyan}>{' › '}</Text>
        </Clickable>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text bold wrap="truncate">{title(nav)}</Text>
      </Box>
    </Box>
  )
}

/** Right-hand pane: the selected event, else the next one still ahead in the range. Click opens it. */
function Preview({ event, selected, now, width, height, onOpen }: {
  event?: CalEvent
  selected: boolean
  now: Date
  width: number
  height: number
  onOpen(e: CalEvent): void
}) {
  const { accounts, calendars } = useDirectory()
  const account = event && accounts.find((a) => a.id === event.accountId)
  const calendar = event && calendars.find((c) => c.accountId === event.accountId && c.id === event.calendarId)
  const [showAll, setShowAll] = useState(false) // reset per event: the shell keys Preview by event
  return (
    <Clickable
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={selected ? C.accent : C.muted}
      paddingX={1}
      overflow="hidden"
      onClick={event && (() => onOpen(event))}
    >
      {event ? (
        <>
          <Text color={C.muted}>{selected ? 'Selected · enter or click to open' : 'Up next · ←/→ to select'}</Text>
          <EventInfo event={event} account={account} calendar={calendar} now={now} showAll={showAll} onToggleAll={() => setShowAll(!showAll)} />
        </>
      ) : (
        <Text color={C.muted}>Nothing ahead in this range</Text>
      )}
    </Clickable>
  )
}

function title({ view, date }: Nav): string {
  if (view === 'month') return format(date, 'MMMM yyyy')
  if (view === 'day') return format(date, 'EEE d MMM yyyy')
  const days =
    view === 'agenda' ? [date, addDays(date, AGENDA_DAYS - 1)] : view === '2day' ? [date, addDays(date, 1)] : viewDays(view, date)
  return rangeLabel(days[0], days[days.length - 1])
}

const chronological = (a: CalEvent, b: CalEvent): number =>
  eventBounds(a).start.getTime() - eventBounds(b).start.getTime() || Number(b.allDay) - Number(a.allDay)

export function App(props: { initialNav?: Nav }) {
  return (
    <MouseProvider>
      <Shell {...props} />
    </MouseProvider>
  )
}

function Shell({ initialNav }: { initialNav?: Nav }) {
  const api = useApi()
  const { exit } = useApp()
  // False when stdin is piped: keys are off (overlays can't open then, so only the shell needs this check).
  const { isRawModeSupported } = useStdin()
  const { nav, setView, setDate, shift, today } = useNav(initialNav)
  const range = useMemo(() => navRange(nav), [nav])
  const { events, loadedFor, error } = useEvents(range)
  const now = useNow()
  const { width, height } = useTermSize()
  const [selectedKey, setSelectedKey] = useState<string>()
  const [overlay, setOverlay] = useState<Overlay>()
  const [message, setMessage] = useState<string>()

  const ordered = useMemo(() => [...events].sort(chronological), [events])
  const selectedIdx = ordered.findIndex((e) => eventKey(e) === selectedKey)
  const selected = selectedIdx >= 0 ? ordered[selectedIdx] : undefined
  const close = (): void => setOverlay(undefined)

  // Day cursor of the grid views (day, 2day, week, month); falls back to the anchor day once off the page.
  const [cursorAt, setCursor] = useState(() => startOfDay(nav.date))
  const onPageOf = ({ view, date }: Nav, day: Date): boolean => {
    if (view === 'month') return isSameMonth(day, date)
    const r = navRange({ view, date })
    return day >= new Date(r.start) && day < new Date(r.end)
  }
  const cursor = onPageOf(nav, cursorAt) ? cursorAt : startOfDay(nav.date)
  const grid = nav.view !== 'agenda'

  // Keys can arrive faster than renders (key repeat), so steps read and write the latest cursor, page, selection and
  // the time of day being followed across days here rather than in render-time values.
  const live = useRef<{ cursor: Date; view: View; date: Date; key?: string; minute?: number }>({ cursor, ...nav })
  // Sync from render only when the rendered state changes: a render that runs before a key's queued update
  // lands still shows the old state and must not undo what that key already wrote here.
  const rendered = useRef('')
  const snapshot = `${+cursor}|${nav.view}|${+nav.date}|${selectedKey}`
  if (snapshot !== rendered.current) {
    rendered.current = snapshot
    Object.assign(live.current, { cursor, ...nav, key: selectedKey })
  }
  const choose = (e?: CalEvent): void => {
    live.current.key = e && eventKey(e)
    setSelectedKey(live.current.key)
  }

  /** Selects `e` (or nothing) and moves the cursor to its day, clamped to the page. */
  const select = (e?: CalEvent): void => {
    choose(e)
    if (!e) return
    live.current.cursor = max([startOfDay(eventBounds(e).start), startOfDay(new Date(range.start))])
    setCursor(live.current.cursor)
  }

  /** The event of `day` starting closest to `minute` (the first one when no minute), else nothing. */
  const pickOn = (list: CalEvent[], day: Date, minute?: number): CalEvent | undefined => {
    const on = eventsOnDay(list, day)
    if (minute === undefined) return on[0]
    const at = (e: CalEvent): number => (e.allDay ? Infinity : Math.max(differenceInMinutes(eventBounds(e).start, day), 0))
    return on.reduce<CalEvent | undefined>((best, e) => (!best || Math.abs(at(e) - minute) < Math.abs(at(best) - minute) ? e : best), undefined)
  }

  // A step that leaves the page pages over; it finishes once the new page's events load.
  type Pending = { dir: 1 | -1; from: number } | { day: Date; minute?: number }
  const pending = useRef<Pending>(undefined)
  useEffect(() => {
    const p = pending.current
    if (!p || loadedFor !== `${range.start}/${range.end}`) return // wait for the new page, not a reload of the old one
    pending.current = undefined
    if ('day' in p) return choose(pickOn(ordered, p.day, p.minute))
    const at = (e: CalEvent): number => eventBounds(e).start.getTime()
    const next = p.dir > 0 ? ordered.find((e) => at(e) > p.from) : [...ordered].reverse().find((e) => at(e) < p.from)
    select(next ?? ordered[p.dir > 0 ? 0 : ordered.length - 1])
  }, [ordered])

  /** j/k (and agenda arrows): next/previous event in time order, paging at the ends. */
  const move = (dir: 1 | -1): void => {
    const i = ordered.findIndex((e) => eventKey(e) === live.current.key)
    if (i >= 0 && i + dir >= 0 && i + dir < ordered.length) return select(ordered[i + dir])
    if (i < 0 && ordered.length) return select(ordered[dir > 0 ? 0 : ordered.length - 1])
    pending.current = { dir, from: i >= 0 ? eventBounds(ordered[i]).start.getTime() : dir > 0 ? -Infinity : Infinity }
    shift(dir)
  }

  /** Grid ←/→ (±1) and month ↑/↓ (±7): moves the cursor, selecting the event there closest to the followed time. */
  const stepDay = (n: number): void => {
    const { cursor: from, view, date, key } = live.current
    const sel = ordered.find((e) => eventKey(e) === key)
    const minute = sel ? (sel.allDay ? undefined : Math.max(differenceInMinutes(eventBounds(sel).start, from), 0)) : live.current.minute
    const day = addDays(from, n)
    const nextDate = onPageOf({ view, date }, day) ? date : view === '2day' && n > 0 ? addDays(day, -1) : day
    Object.assign(live.current, { cursor: day, date: nextDate, minute })
    setCursor(day)
    if (+nextDate !== +date) setDate(nextDate)
    // this page's events are loaded: pick now (a burst may still be ahead of the render, hence both checks)
    if (+nextDate === +nav.date && view === nav.view) return choose(pickOn(events, day, minute))
    live.current.key = undefined
    pending.current = { day, minute }
  }

  /** Grid ↑/↓: previous/next event within the cursor day. */
  const stepInDay = (dir: 1 | -1): void => {
    const on = eventsOnDay(events, live.current.cursor)
    const i = on.findIndex((e) => eventKey(e) === live.current.key)
    const e = i < 0 ? on[dir > 0 ? 0 : on.length - 1] : on[Math.min(Math.max(i + dir, 0), on.length - 1)]
    if (e) choose(e)
  }

  /** New events start on the cursor day (agenda: the anchor day) at the current time; the editor rounds it up. */
  const newStart = (): Date => (grid ? set(cursor, { hours: now.getHours(), minutes: now.getMinutes() }) : nav.date)

  const syncNow = (): void => {
    setMessage('Syncing…')
    api.sync.now().then(
      () => setMessage('Synced'),
      (e: unknown) => setMessage(`Sync failed: ${errorText(e)}`)
    )
  }

  const openDay = (day: Date): void => {
    setDate(day)
    setCursor(startOfDay(day))
    setView('day')
  }

  useKeys(
    (input, key) => {
      if (Object.hasOwn(VIEW_KEYS, input)) {
        live.current.view = VIEW_KEYS[input]
        return setView(live.current.view)
      }
      if (input === 'H' || (key.shift && key.leftArrow)) return shift(-1)
      if (input === 'L' || (key.shift && key.rightArrow)) return shift(1)
      if (input === 't') {
        setCursor(startOfDay(new Date()))
        return today()
      }
      if (input === 'j') return move(1)
      if (input === 'k') return move(-1)
      const dir = input === 'l' || key.rightArrow ? 1 : input === 'h' || key.leftArrow ? -1 : 0
      const vdir = key.downArrow ? 1 : key.upArrow ? -1 : 0
      const view = live.current.view
      if (view === 'agenda' && (dir || vdir)) return move((dir || vdir) as 1 | -1)
      if (dir) return stepDay(dir)
      if (vdir) return view === 'month' ? stepDay(7 * vdir) : stepInDay(vdir as 1 | -1)
      if (key.return && selected) return setOverlay({ kind: 'details', event: selected })
      if (input === 'n') return setOverlay({ kind: 'editor', initialStart: newStart() })
      if (input === 'i') return setOverlay({ kind: 'invites' })
      if (input === 's') return setOverlay({ kind: 'accounts' })
      if (input === 'r') return syncNow()
      if (input === '?') return setOverlay({ kind: 'help' })
      if (input === 'q') return exit()
    },
    { isActive: !overlay && isRawModeSupported === true }
  )

  const ViewComponent = VIEWS[nav.view]
  const bodyHeight = Math.max(height - 3, 1) // header + 2-row bottom bar
  const paneWidth = !overlay && (nav.view === 'agenda' || nav.view === 'day' || nav.view === '2day') && width >= PANE_MIN_WIDTH ? Math.min(56, Math.floor(width * 0.4)) : 0
  const previewed = selectedIdx >= 0 ? ordered[selectedIdx] : ordered.find((e) => eventBounds(e).end > now)

  const body = (): ReactNode => {
    switch (overlay?.kind) {
      case 'details':
        return (
          <EventDetails event={overlay.event} onClose={close} onEdit={(event) => setOverlay({ kind: 'editor', event })} />
        )
      case 'editor':
        return <EventEditor event={overlay.event} initialStart={overlay.initialStart} onClose={close} />
      case 'accounts':
        return <Accounts onClose={close} />
      case 'invites':
        return <Invites onClose={close} />
      case 'help':
        return <Help onClose={close} />
      default:
        return (
          <>
            <ViewComponent
              events={events}
              date={nav.date}
              now={now}
              selectedKey={selectedIdx >= 0 ? selectedKey : undefined}
              cursor={grid ? cursor : undefined}
              onSelect={select}
              onOpen={(event) => setOverlay({ kind: 'details', event })}
              onPickDay={openDay}
              onCreate={(start) => setOverlay({ kind: 'editor', initialStart: start })}
              width={width - paneWidth}
              height={bodyHeight}
            />
            {paneWidth > 0 && (
              <Preview
                key={previewed && eventKey(previewed)}
                event={previewed}
                selected={selectedIdx >= 0}
                now={now}
                width={paneWidth}
                height={bodyHeight}
                onOpen={(event) => setOverlay({ kind: 'details', event })}
              />
            )}
          </>
        )
    }
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Header
        nav={nav}
        width={width}
        onView={(v) => !overlay && setView(v)}
        onShift={(dir) => !overlay && shift(dir)}
        onToday={() => !overlay && today()}
      />
      <Clickable flexDirection={overlay ? 'column' : 'row'} height={bodyHeight} onWheel={overlay ? undefined : move}>
        {body()}
      </Clickable>
      <StatusLine
        nav={nav}
        events={events}
        now={now}
        message={error ? `Error: ${error}` : message}
        width={width}
        onOpen={(event) => !overlay && setOverlay({ kind: 'details', event })}
        onInvites={() => !overlay && setOverlay({ kind: 'invites' })}
        onAccounts={() => !overlay && setOverlay({ kind: 'accounts' })}
        onHelp={() => !overlay && setOverlay({ kind: 'help' })}
        onNew={() => !overlay && setOverlay({ kind: 'editor', initialStart: newStart() })}
        onSync={syncNow}
        onQuit={() => !overlay && exit()}
      />
    </Box>
  )
}
