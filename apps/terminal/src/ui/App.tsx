import { useMemo, useState, type ReactNode } from 'react'
import { Box, Text, useApp, useInput, useStdin } from 'ink'
import { addDays, format } from 'date-fns'
import { eventBounds, rangeLabel, viewDays } from '@multicals/core/logic/layout'
import { errorText } from '@multicals/core/logic/editor'
import type { CalEvent } from '@multicals/core/shared/types'
import { AGENDA_DAYS, eventKey, navRange, useApi, useEvents, useNav, useNow, useTermSize, type Nav, type View, type ViewProps } from './hooks'
import { Agenda } from './views/Agenda'
import { Day } from './views/Day'
import { Week } from './views/Week'
import { Month } from './views/Month'
import { EventDetails } from './screens/EventDetails'
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

const VIEWS: Record<View, (p: ViewProps) => ReactNode> = { agenda: Agenda, day: Day, week: Week, month: Month }
const VIEW_KEYS: Record<string, View> = { a: 'agenda', d: 'day', w: 'week', m: 'month' }

const HELP: [string, string][] = [
  ['a d w m', 'agenda / day / week / month'],
  ['h l  ← →', 'previous / next page'],
  ['t', 'today'],
  ['j k  ↓ ↑', 'select next / previous event'],
  ['enter', 'open selected event'],
  ['n', 'new event'],
  ['i', 'invites'],
  ['s', 'accounts & calendars'],
  ['r', 'sync now'],
  ['?', 'this help'],
  ['q', 'quit']
]

function Help({ onClose }: { onClose(): void }) {
  useInput(() => onClose())
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Keys</Text>
      {HELP.map(([k, d]) => (
        <Text key={k}>
          <Text color="cyan">{k.padEnd(10)}</Text> {d}
        </Text>
      ))}
      <Text dimColor>any key to close</Text>
    </Box>
  )
}

function title({ view, date }: Nav): string {
  if (view === 'month') return format(date, 'MMMM yyyy')
  if (view === 'day') return format(date, 'EEE d MMM yyyy')
  const days = view === 'agenda' ? [date, addDays(date, AGENDA_DAYS - 1)] : viewDays(view, date)
  return rangeLabel(days[0], days[days.length - 1])
}

const chronological = (a: CalEvent, b: CalEvent): number =>
  eventBounds(a).start.getTime() - eventBounds(b).start.getTime() || Number(b.allDay) - Number(a.allDay)

export function App({ initialNav }: { initialNav?: Nav }) {
  const api = useApi()
  const { exit } = useApp()
  // False when stdin is piped: keys are off (overlays can't open then, so only the shell needs this check).
  const { isRawModeSupported } = useStdin()
  const { nav, setView, shift, today } = useNav(initialNav)
  const range = useMemo(() => navRange(nav), [nav])
  const { events, error } = useEvents(range)
  const now = useNow()
  const { width, height } = useTermSize()
  const [selectedKey, setSelectedKey] = useState<string>()
  const [overlay, setOverlay] = useState<Overlay>()
  const [message, setMessage] = useState<string>()

  const ordered = useMemo(() => [...events].sort(chronological), [events])
  const selectedIdx = ordered.findIndex((e) => eventKey(e) === selectedKey)
  const close = (): void => setOverlay(undefined)

  const move = (dir: 1 | -1): void => {
    if (!ordered.length) return
    const i = selectedIdx < 0 ? (dir > 0 ? 0 : ordered.length - 1) : Math.min(Math.max(selectedIdx + dir, 0), ordered.length - 1)
    setSelectedKey(eventKey(ordered[i]))
  }

  const syncNow = (): void => {
    setMessage('Syncing…')
    api.sync.now().then(
      () => setMessage('Synced'),
      (e: unknown) => setMessage(`Sync failed: ${errorText(e)}`)
    )
  }

  useInput(
    (input, key) => {
      if (Object.hasOwn(VIEW_KEYS, input)) return setView(VIEW_KEYS[input])
      if (input === 'h' || key.leftArrow) return shift(-1)
      if (input === 'l' || key.rightArrow) return shift(1)
      if (input === 't') return today()
      if (input === 'j' || key.downArrow) return move(1)
      if (input === 'k' || key.upArrow) return move(-1)
      if (key.return && selectedIdx >= 0) return setOverlay({ kind: 'details', event: ordered[selectedIdx] })
      if (input === 'n') return setOverlay({ kind: 'editor', initialStart: nav.date })
      if (input === 'i') return setOverlay({ kind: 'invites' })
      if (input === 's') return setOverlay({ kind: 'accounts' })
      if (input === 'r') return syncNow()
      if (input === '?') return setOverlay({ kind: 'help' })
      if (input === 'q') return exit()
    },
    { isActive: !overlay && isRawModeSupported === true }
  )

  const ViewComponent = VIEWS[nav.view]
  const bodyHeight = Math.max(height - 2, 1)

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
          <ViewComponent
            events={events}
            date={nav.date}
            now={now}
            selectedKey={selectedIdx >= 0 ? selectedKey : undefined}
            onSelect={(e) => setSelectedKey(eventKey(e))}
            onOpen={(event) => setOverlay({ kind: 'details', event })}
            width={width}
            height={bodyHeight}
          />
        )
    }
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>
        <Text bold color="cyan">multicals</Text> <Text bold>{nav.view[0].toUpperCase() + nav.view.slice(1)}</Text>{' '}
        {title(nav)}
      </Text>
      <Box flexDirection="column" height={bodyHeight}>
        {body()}
      </Box>
      <StatusLine nav={nav} events={events} now={now} message={error ? `Error: ${error}` : message} width={width} />
    </Box>
  )
}
