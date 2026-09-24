/**
 * Bottom bar, two rows truncated to `width`:
 *   1. info: a spinner while accounts sync, current event(s) and the next one within 24h (core `pickNowNext`, `startsLabel`), pending invite count,
 *      accounts whose last sync failed, a transient `message` from the shell, and last a newer-version hint (`update`);
 *   2. actions: new, sync, invites, accounts, help, quit as key buttons.
 * Every part is clickable (opens the event / overlay, or runs the action).
 * Now/next and invites come from a today+60d fetch, so they don't depend on the viewed range.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { pickNowNext, startsLabel } from '@mysticals/core/logic/status'
import { pendingInvites } from '@mysticals/core/logic/details'
import type { CalEvent } from '@mysticals/core/shared/types'
import { useDirectory, type Nav } from './hooks'
import { Button, Clickable } from './mouse'
import { useUpcoming } from './screens/Invites'
import { C } from './theme'

export interface StatusLineProps {
  nav: Nav
  /** Unused: the status line loads its own upcoming window. Kept for the shell's contract. */
  events: CalEvent[]
  now: Date
  message?: string
  /** Newer published version (see `checkUpdate`); shows an install hint at the end of the info row. */
  update?: string
  width: number
  onOpen?(e: CalEvent): void
  onInvites?(): void
  onAccounts?(): void
  onHelp?(): void
  onNew?(): void
  onSync?(): void
  onQuit?(): void
}

const DAY_MS = 24 * 3600_000
const noop = (): void => {}
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** Braille spinner; animates only while mounted. */
export function Spinner() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 100)
    return () => clearInterval(t)
  }, [])
  return <Text color={C.accent}>{FRAMES[i]}</Text>
}

export function StatusLine({ now, message, update, width, onOpen, onInvites, onAccounts, onHelp, onNew, onSync, onQuit }: StatusLineProps) {
  const { events } = useUpcoming(now)
  const { accounts } = useDirectory()
  const failed = accounts.filter((a) => a.error)
  const syncing = accounts.filter((a) => a.syncing)
  const { current, next } = pickNowNext(events, now)
  const soon = next && Date.parse(next.start) - now.getTime() < DAY_MS ? next : undefined
  const invites = pendingInvites(events, now).length

  const parts: [ReactNode, (() => void)?][] = []
  if (syncing.length) parts.push([<><Spinner /> <Text color={C.muted}>syncing {syncing.map((a) => a.label).join(', ')}</Text></>, onAccounts])
  for (const e of current) parts.push([<><Text color={C.green} bold>now</Text> {e.title || 'Untitled'}</>, onOpen && (() => onOpen(e))])
  if (soon) parts.push([<><Text color={C.cyan} bold>next</Text> {soon.title || 'Untitled'} <Text color={C.yellow}>{startsLabel(soon.start, now)}</Text></>, onOpen && (() => onOpen(soon))])
  if (invites) parts.push([<Text color={C.yellow}>{invites === 1 ? '1 invite' : `${invites} invites`} (i)</Text>, onInvites])
  if (failed.length) parts.push([<Text color={C.red}>⚠ {failed.map((a) => a.label).join(', ')} sync failed (s)</Text>, onAccounts])
  if (message) parts.push([message])
  if (!parts.length) parts.push([<Text color={C.muted}>nothing on in the next 24h</Text>])
  if (update) parts.push([<Text color={C.yellow}>↑ {update} available · npm i -g mysticals</Text>])

  // Parts never shrink; each row clips at `width`, so the tail is what gets cut.
  return (
    <Box flexDirection="column" width={width} height={2}>
      <Box width={width} height={1} overflow="hidden">
        {parts.map(([p, onClick], i) => (
          <Clickable key={i} flexShrink={0} onClick={onClick}>
            <Text>
              {i > 0 && <Text color={C.muted}> · </Text>}
              {p}
            </Text>
          </Clickable>
        ))}
      </Box>
      <Box width={width} height={1} overflow="hidden">
        <Button k="n" label="new" onPress={onNew ?? noop} />
        <Button k="r" label="sync" onPress={onSync ?? noop} />
        <Button k="i" label="invites" onPress={onInvites ?? noop} />
        <Button k="s" label="accounts" onPress={onAccounts ?? noop} />
        <Button k="?" label="help" onPress={onHelp ?? noop} />
        <Button k="q" label="quit" onPress={onQuit ?? noop} />
      </Box>
    </Box>
  )
}
