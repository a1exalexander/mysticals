/**
 * Accounts & calendars overlay (key `s`): list accounts with their calendars, toggle calendar visibility,
 * add Google / CalDAV account, rename/recolor, remove, sync, show per-account sync errors.
 * Mirrors desktop components/Accounts.tsx + Settings.tsx (accounts + sync tabs).
 *
 * While open this overlay owns ALL input; esc/q closes (esc backs out of sub-forms first).
 * Mouse: click a row to select it (a selected calendar again to show/hide it), wheel moves, buttons act on the selection.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { errorText } from '@multicals/core/logic/editor'
import type { Account, Calendar } from '@multicals/core/shared/types'
import { useApi, useDirectory } from '../hooks'
import { Button, Clickable, useKeys } from '../mouse'
import { ansiOf, C } from '../theme'
import { AddCaldav, PALETTE, cycle, editText, useKeyState } from './AddCaldav'

export interface AccountsProps {
  onClose(): void
}

type Row = { account: Account; calendar?: Calendar }
type Mode =
  | { kind: 'list' | 'google' | 'caldav' }
  | { kind: 'rename'; account: Account; value: string }
  | { kind: 'confirm'; account: Account }

export function Accounts({ onClose }: AccountsProps) {
  const api = useApi()
  const { accounts, calendars, loaded, error: loadError } = useDirectory()
  const [getCursor, setCursor] = useKeyState(0)
  const [getMode, setMode] = useKeyState<Mode>({ kind: 'list' })
  const mode = getMode()
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()
  // Bumped when a Google sign-in is abandoned so its late result is ignored.
  const googleSession = useRef(0)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const rows: Row[] = accounts.flatMap((account) => [
    { account },
    ...calendars.filter((c) => c.accountId === account.id).map((calendar) => ({ account, calendar }))
  ])
  const current = (): { idx: number; row?: Row } => {
    const idx = Math.min(getCursor(), Math.max(rows.length - 1, 0))
    return { idx, row: rows[idx] }
  }
  const { idx } = current()

  const say = (text: string, error = false): void => {
    if (alive.current) setMessage({ text, error })
  }
  const run = (pending: string, done: string, fn: () => Promise<unknown>): void => {
    say(pending)
    fn().then(
      () => say(done),
      (e: unknown) => say(errorText(e), true)
    )
  }

  const addGoogle = (): void => {
    const s = ++googleSession.current
    setMode({ kind: 'google' })
    setMessage(undefined)
    api.accounts.addGoogle().then(
      (a) => s === googleSession.current && (setMode({ kind: 'list' }), say(`Added ${a.label}`)),
      (e: unknown) => s === googleSession.current && (setMode({ kind: 'list' }), say(errorText(e), true))
    )
  }

  const move = (dir: 1 | -1): void => setCursor(Math.max(Math.min(current().idx + dir, rows.length - 1), 0))
  // Row actions, shared by keys and buttons; each acts on the selected row.
  const act = (input: string): void => {
    const { row } = current()
    if (input === 'R') return run('Syncing all…', 'Synced all', () => api.sync.now())
    if (input === 'g') return addGoogle()
    if (input === 'a') return setMode({ kind: 'caldav' })
    if (!row) return
    const a = row.account
    const c = row.calendar
    if (input === ' ' && c) {
      return run('Saving…', `${c.name} ${c.visible === false ? 'shown' : 'hidden'}`, () =>
        api.calendars.setVisible(a.id, c.id, c.visible === false)
      )
    }
    if (input === 'r') return run(`Syncing ${a.label}…`, `Synced ${a.label}`, () => api.sync.now(a.id))
    if (input === 'e') return setMode({ kind: 'rename', account: a, value: a.label })
    if (input === 'c') {
      const color = cycle(PALETTE, a.color, 1)
      return run('Saving…', `${a.label} colour changed`, () => api.accounts.update(a.id, { color }))
    }
    if (input === 'x') return setMode({ kind: 'confirm', account: a })
  }
  const confirmRemove = (yes: boolean): void => {
    const mode = getMode()
    if (mode.kind !== 'confirm') return
    if (yes) run(`Removing ${mode.account.label}…`, `Removed ${mode.account.label}`, () => api.accounts.remove(mode.account.id))
    setMode({ kind: 'list' })
  }
  const listing = (): boolean => getMode().kind === 'list'
  const click = (i: number): void => {
    if (!listing()) return
    if (i === current().idx && rows[i]?.calendar) return act(' ')
    setCursor(i)
  }

  useKeys(
    (input, key) => {
      const mode = getMode()
      if (mode.kind === 'google') {
        if (key.escape || input === 'q') {
          googleSession.current++
          setMode({ kind: 'list' })
        }
        return
      }
      if (mode.kind === 'confirm') return confirmRemove(input.toLowerCase() === 'y')
      if (mode.kind === 'rename') {
        if (key.escape) return setMode({ kind: 'list' })
        if (key.return) {
          const next = mode.value.trim()
          if (next && next !== mode.account.label) {
            const id = mode.account.id
            run('Saving…', `Renamed to ${next}`, () => api.accounts.update(id, { label: next }))
          }
          return setMode({ kind: 'list' })
        }
        const value = editText(mode.value, input, key)
        if (value !== undefined) setMode({ ...mode, value })
        return
      }
      if (key.escape || input === 'q') return onClose()
      if (input === 'j' || key.downArrow) return move(1)
      if (input === 'k' || key.upArrow) return move(-1)
      act(input)
    },
    { isActive: mode.kind !== 'caldav' }
  )

  if (mode.kind === 'caldav') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={1}>
        <AddCaldav
          onBack={() => setMode({ kind: 'list' })}
          onDone={() => {
            setMode({ kind: 'list' })
            say('Account added')
          }}
        />
      </Box>
    )
  }

  const button = (k: string, label: string, input = k): ReactNode => (
    <Button k={k} label={label} onPress={() => listing() && act(input)} />
  )
  const row = rows[idx]

  return (
    <Clickable flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={1} onWheel={(dir) => listing() && move(dir)}>
      <Text bold>Accounts & calendars</Text>
      <Text color={C.muted}>Accounts sync automatically every 2 minutes.</Text>
      {loaded && !accounts.length && <Text color={C.muted}>No accounts yet. Press g (Google) or a (CalDAV) to add one.</Text>}
      {rows.map((r, i) => {
        const sel = i === idx
        const mark = <Text color={C.cyan}>{sel ? '› ' : '  '}</Text>
        if (r.calendar) {
          const c = r.calendar
          return (
            <Clickable key={`${c.accountId}/${c.id}`} onClick={() => click(i)}>
              <Text inverse={sel}>
                {mark}
                {'    '}
                {c.visible === false ? '[ ]' : '[x]'} <Text color={ansiOf(c.color)}>●</Text> {c.name}
                {c.readOnly && <Text color={C.muted}> (read-only)</Text>}
              </Text>
            </Clickable>
          )
        }
        const a = r.account
        const renaming = mode.kind === 'rename' && mode.account.id === a.id
        return (
          <Box key={a.id} flexDirection="column">
            <Clickable onClick={() => click(i)}>
              <Text inverse={sel && !renaming}>
                {mark}
                <Text color={ansiOf(a.color)}>●</Text>{' '}
                {renaming ? (
                  <Text color={C.cyan}>
                    {mode.value}▏
                  </Text>
                ) : (
                  <Text bold>{a.label}</Text>
                )}{' '}
                <Text color={C.muted}>
                  {a.email} · {a.kind === 'google' ? 'Google' : 'CalDAV'}
                </Text>
              </Text>
            </Clickable>
            {a.error && <Text color={C.red}>{`    Last sync failed: ${a.error}`}</Text>}
          </Box>
        )
      })}
      {mode.kind === 'confirm' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={C.red} bold>
            Remove {mode.account.label} ({mode.account.email})? [y/N]
          </Text>
          <Text>Removes local data and credentials for {mode.account.email}. Nothing is deleted on the server.</Text>
          <Box>
            <Button k="y" label="remove" color={C.red} onPress={() => confirmRemove(true)} />
            <Button k="n" label="keep" onPress={() => confirmRemove(false)} />
          </Box>
        </Box>
      )}
      {mode.kind === 'google' && (
        <Text color={C.yellow}>Opening browser — finish sign-in there… (esc to stop waiting)</Text>
      )}
      {mode.kind === 'rename' && <Text color={C.muted}>enter save  esc cancel</Text>}
      {loadError && <Text color={C.red}>{loadError}</Text>}
      {message && <Text color={message.error ? C.red : C.green}>{message.text}</Text>}
      {mode.kind === 'list' && (
        <Box marginTop={1} flexWrap="wrap">
          <Box marginRight={2}>
            <Text color={C.muted}>j/k move</Text>
          </Box>
          {row?.calendar && button('space', 'show/hide', ' ')}
          {row && button('r', 'sync')}
          {button('R', 'sync all')}
          {row && button('e', 'rename')}
          {row && button('c', 'colour')}
          {row && button('x', 'remove')}
          {button('g', 'add Google')}
          {button('a', 'add CalDAV')}
          <Button k="esc" label="close" onPress={onClose} />
        </Box>
      )}
    </Clickable>
  )
}
