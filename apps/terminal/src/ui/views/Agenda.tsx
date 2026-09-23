/**
 * Agenda (default view): scrollable list of events grouped by day, AGENDA_DAYS days from `date`.
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Keys: the App shell owns them all (a d w m, h/l ←/→, t, j/k ↓/↑ select, enter open, n i s r ? q).
 * The view must keep the selected event scrolled into view within `height` rows. It may add useInput
 * handlers only for keys the shell does not use.
 */
import { Text } from 'ink'
import type { ViewProps } from '../hooks'

export function Agenda(_props: ViewProps) {
  return <Text>Agenda view</Text>
}
