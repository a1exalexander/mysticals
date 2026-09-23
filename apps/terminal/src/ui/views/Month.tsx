/**
 * Month view: 6x7 grid (core `monthGrid(date)`), a few event titles per cell plus "+N more".
 *
 * Props: ViewProps (ui/hooks.ts) — { events, date, now, selectedKey?, onSelect, onOpen, width, height }.
 * Keys: the App shell owns them all (a d w m, h/l ←/→, t, j/k ↓/↑ select, enter open, n i s r ? q).
 * It may add useInput handlers only for keys the shell does not use.
 */
import { Text } from 'ink'
import type { ViewProps } from '../hooks'

export function Month(_props: ViewProps) {
  return <Text>Month view</Text>
}
