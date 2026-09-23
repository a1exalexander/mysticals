/**
 * Day view: all-day events on top, then a time grid / timed list for `date`.
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Keys: the App shell owns them all (a d w m, h/l ←/→, t, j/k ↓/↑ select, enter open, n i s r ? q).
 * It may add useInput handlers only for keys the shell does not use.
 */
import { Text } from 'ink'
import type { ViewProps } from '../hooks'

export function Day(_props: ViewProps) {
  return <Text>Day view</Text>
}
