/**
 * Accounts & calendars overlay (key `s`): list accounts with their calendars, toggle calendar visibility,
 * add Google / CalDAV account, rename/recolor, remove, sync, show per-account sync errors.
 * Mirrors desktop components/Accounts.tsx + Settings.tsx (accounts + sync tabs).
 *
 * While open this overlay owns ALL input; esc/q closes (esc backs out of sub-forms first).
 */
import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { errorText } from '@multicals/core/logic/editor'
import type { Account, Calendar } from '@multicals/core/shared/types'
import { useApi, useDirectory } from '../hooks'
import { AddCaldav, PALETTE, cycle, editText, useKeyState } from './AddCaldav'

export interface AccountsProps {
  onClose(): void
}

type Row = { account: Account; calendar?: Calendar }
type Mode =
  | { kind: 'list' | 'google' | 'caldav' }
  | { kind: 'rename'; account: Account; value: string }
  | { kind: 'confirm'; account: Account }

const HINT = 'j/k move  space show/hide  r sync  R sync all  e rename  c colour  x remove  g add Google  a add CalDAV  esc close'

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

  useInput(
    (input, key) => {
      const mode = getMode()
      const { idx, row } = current()
      if (mode.kind === 'google') {
        if (key.escape || input === 'q') {
          googleSession.current++
          setMode({ kind: 'list' })
        }
        return
      }
      if (mode.kind === 'confirm') {
        if (input.toLowerCase() === 'y') {
          const a = mode.account
          run(`Removing ${a.label}…`, `Removed ${a.label}`, () => api.accounts.remove(a.id))
        }
        return setMode({ kind: 'list' })
      }
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
      if (input === 'j' || key.downArrow) return setCursor(Math.max(Math.min(idx + 1, rows.length - 1), 0))
      if (input === 'k' || key.upArrow) return setCursor(Math.max(idx - 1, 0))
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
    },
    { isActive: mode.kind !== 'caldav' }
  )

  if (mode.kind === 'caldav') {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
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

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Accounts & calendars</Text>
      <Text dimColor>Accounts sync automatically every 2 minutes.</Text>
      {loaded && !accounts.length && <Text dimColor>No accounts yet. Press g (Google) or a (CalDAV) to add one.</Text>}
      {rows.map((r, i) => {
        const sel = i === idx
        const mark = <Text color="cyan">{sel ? '› ' : '  '}</Text>
        if (r.calendar) {
          const c = r.calendar
          return (
            <Text key={`${c.accountId}/${c.id}`} inverse={sel}>
              {mark}
              {'    '}
              {c.visible === false ? '[ ]' : '[x]'} <Text color={c.color}>●</Text> {c.name}
              {c.readOnly && <Text dimColor> (read-only)</Text>}
            </Text>
          )
        }
        const a = r.account
        const renaming = mode.kind === 'rename' && mode.account.id === a.id
        return (
          <Box key={a.id} flexDirection="column">
            <Text inverse={sel && !renaming}>
              {mark}
              <Text color={a.color}>●</Text>{' '}
              {renaming ? (
                <Text color="cyan">
                  {mode.value}▏
                </Text>
              ) : (
                <Text bold>{a.label}</Text>
              )}{' '}
              <Text dimColor>
                {a.email} · {a.kind === 'google' ? 'Google' : 'CalDAV'}
              </Text>
            </Text>
            {a.error && <Text color="red">{`    Last sync failed: ${a.error}`}</Text>}
          </Box>
        )
      })}
      {mode.kind === 'confirm' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red" bold>
            Remove {mode.account.label} ({mode.account.email})? [y/N]
          </Text>
          <Text>Removes local data and credentials for {mode.account.email}. Nothing is deleted on the server.</Text>
        </Box>
      )}
      {mode.kind === 'google' && (
        <Text color="yellow">Opening browser — finish sign-in there… (esc to stop waiting)</Text>
      )}
      {mode.kind === 'rename' && <Text dimColor>enter save  esc cancel</Text>}
      {loadError && <Text color="red">{loadError}</Text>}
      {message && <Text color={message.error ? 'red' : 'green'}>{message.text}</Text>}
      <Text dimColor wrap="wrap">
        {HINT}
      </Text>
    </Box>
  )
}
