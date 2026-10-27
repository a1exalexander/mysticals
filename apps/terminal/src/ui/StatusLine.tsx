/**
 * Bottom bar, two rows truncated to `width`:
 *   1. info: a spinner while accounts sync, current event(s) and the next one within 24h (core `pickNowNext`, `startsLabel`), pending invite count,
 *      accounts whose last sync failed, a transient `message` from the shell, and last a newer-version hint (`update`);
 *   2. actions: new, sync, invites, accounts, help, quit as key buttons, then (with `hints`) how to move and open;
 *      too narrow for all labels, only help and quit keep theirs, so `?` stays findable.
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
  /** `message` is a failure: shown in red. */
  messageError?: boolean
  /** Newer published version (see `checkUpdate`); shows an install hint at the end of the info row. */
  update?: string
  width: number
  /** Show the move/open hint after the buttons (off while a panel has the keys). */
  hints?: boolean
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
/** Bottom-bar buttons, key and label; each takes its label plus the key and 3 cells of gaps. */
const ACTIONS = [['n', 'new'], ['r', 'sync'], ['i', 'invites'], ['s', 'accounts'], ['?', 'help'], ['q', 'quit']] as const
const ACTIONS_W = ACTIONS.reduce((n, [k, l]) => n + k.length + l.length + 3, 0)

/** Braille spinner; animates only while mounted. */
export function Spinner() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 100)
    return () => clearInterval(t)
  }, [])
  return <Text color={C.accent}>{FRAMES[i]}</Text>
}

export function StatusLine({ now, message, messageError, update, width, hints, onOpen, onInvites, onAccounts, onHelp, onNew, onSync, onQuit }: StatusLineProps) {
  const { events, loaded } = useUpcoming(now)
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
  const off = failed.filter((a) => a.authError)
  const broken = failed.filter((a) => !a.authError)
  if (off.length) parts.push([<Text color={C.red}>⚠ {off.map((a) => a.label).join(', ')} disconnected (s)</Text>, onAccounts])
  if (broken.length) parts.push([<Text color={C.red}>⚠ {broken.map((a) => a.label).join(', ')} sync failed (s)</Text>, onAccounts])
  if (message) parts.push([<Text color={messageError ? C.red : undefined}>{message}</Text>])
  if (!parts.length && loaded) parts.push([<Text color={C.muted}>nothing on in the next 24h</Text>])
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
        {ACTIONS.map(([k, label]) => (
          <Button
            key={k}
            k={k}
            label={width >= ACTIONS_W || k === '?' || k === 'q' ? label : ''}
            onPress={{ n: onNew, r: onSync, i: onInvites, s: onAccounts, '?': onHelp, q: onQuit }[k] ?? noop}
          />
        ))}
        {hints && (
          <Box flexShrink={0}>
            <Text color={C.muted}>←→↑↓ move · enter open</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
