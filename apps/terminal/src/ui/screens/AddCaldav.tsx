/** Add-CalDAV form inside the Accounts overlay. Mirrors desktop components/Accounts.tsx CaldavForm. */
import { useRef, useState, type ReactNode } from 'react'
import { Box, Text, useInput, type Key } from 'ink'
import { errorText } from '@multicals/core/logic/editor'
import { useApi } from '../hooks'

/** Same palette core api uses for new accounts. */
export const PALETTE = ['#bd93f9', '#50fa7b', '#8be9fd', '#ff79c6', '#ffb86c', '#f1fa8c']

export const PRESETS = [
  { id: 'privateemail', name: 'Namecheap Private Email', url: 'https://dav.privateemail.com/dav.php/' },
  { id: 'icloud', name: 'iCloud', url: 'https://caldav.icloud.com/' },
  { id: 'fastmail', name: 'Fastmail', url: 'https://caldav.fastmail.com/' },
  { id: 'custom', name: 'Custom', url: '' }
] as const

const PERSONAL_DOMAINS = /^(gmail|googlemail|icloud|me|mac|outlook|hotmail|live|yahoo|fastmail|proton|protonmail|aol|gmx|ukr)\./i

/** "Personal" for well-known consumer mail domains, otherwise "Work". */
export function suggestLabel(email: string): string {
  const domain = email.split('@')[1] ?? ''
  if (!domain) return ''
  return PERSONAL_DOMAINS.test(domain) ? 'Personal' : 'Work'
}

/** One-line text editing: printable input appends, backspace/delete drops the last char; other keys → undefined. */
export function editText(value: string, input: string, key: Key): string | undefined {
  if (key.backspace || key.delete) return value.slice(0, -1)
  if (key.ctrl || key.meta || key.escape || key.return || key.tab || key.upArrow || key.downArrow) return undefined
  if (key.leftArrow || key.rightArrow) return undefined
  return input ? value + input : undefined
}

export const cycle = <T,>(list: readonly T[], cur: T, dir: number): T =>
  list[(list.indexOf(cur) + dir + list.length) % list.length]

type Field = 'provider' | 'serverUrl' | 'username' | 'password' | 'label' | 'color'
const FIELDS: Field[] = ['provider', 'serverUrl', 'username', 'password', 'label', 'color']
const NAMES: Record<Field, string> = {
  provider: 'Provider',
  serverUrl: 'Server URL',
  username: 'Email',
  password: 'App password',
  label: 'Label',
  color: 'Colour'
}

/**
 * State read through a getter, so a key handler sees what earlier keys of the same input burst (paste, fast typing)
 * wrote before Ink re-rendered with a fresh handler.
 */
export function useKeyState<T>(init: T): [() => T, (next: T) => void] {
  const ref = useRef(init)
  const [, bump] = useState(0)
  return [
    () => ref.current,
    (next) => {
      ref.current = next
      bump((n) => n + 1)
    }
  ]
}

const INITIAL = {
  field: 'provider' as Field,
  preset: PRESETS[0].id as string,
  serverUrl: PRESETS[0].url as string,
  username: '',
  password: '',
  label: '',
  labelTouched: false,
  color: PALETTE[0],
  busy: false,
  error: ''
}

export function AddCaldav({ onBack, onDone }: { onBack(): void; onDone(): void }) {
  const api = useApi()
  const [get, set] = useKeyState(INITIAL)
  const patch = (p: Partial<typeof INITIAL>): void => set({ ...get(), ...p })

  const submit = (): void => {
    const v = get()
    const input = {
      serverUrl: v.serverUrl.trim(),
      username: v.username.trim(),
      password: v.password,
      label: v.label.trim() || v.username.trim(),
      color: v.color
    }
    if (!input.serverUrl || !input.username || !input.password)
      return patch({ error: 'Server URL, email and app password are required' })
    patch({ busy: true, error: '' })
    api.accounts.addCaldav(input).then(onDone, (e: unknown) => patch({ error: errorText(e), busy: false }))
  }

  useInput((input, key) => {
    const v = get()
    // ponytail: no cancel while verifying; the request can't be aborted anyway.
    if (v.busy) return
    if (key.escape) return onBack()
    if (key.return) return submit()
    if (key.tab || key.downArrow) return patch({ field: cycle(FIELDS, v.field, key.shift ? -1 : 1) })
    if (key.upArrow) return patch({ field: cycle(FIELDS, v.field, -1) })
    const { field } = v
    if (field === 'provider' || field === 'color') {
      const dir = key.leftArrow || input === 'h' ? -1 : key.rightArrow || input === 'l' || input === ' ' ? 1 : 0
      if (!dir) return
      if (field === 'color') return patch({ color: cycle(PALETTE, v.color, dir) })
      const p = cycle(PRESETS, PRESETS.find((x) => x.id === v.preset)!, dir)
      return patch({ preset: p.id, serverUrl: p.url })
    }
    const next = editText(v[field], input, key)
    if (next === undefined) return
    patch({
      [field]: next,
      ...(field === 'username' && !v.labelTouched && { label: suggestLabel(next) }),
      ...(field === 'serverUrl' && { preset: 'custom' }),
      ...(field === 'label' && { labelTouched: true })
    })
  })

  const v = get()
  const shown = (f: Field): ReactNode => {
    if (f === 'provider') return `‹ ${PRESETS.find((p) => p.id === v.preset)!.name} ›`
    if (f === 'color') return <Text color={v.color}>‹ ● {v.color} ›</Text>
    if (f === 'password') return '•'.repeat(v.password.length)
    return v[f] || <Text dimColor>{f === 'serverUrl' ? 'https://caldav.example.com/' : f === 'username' ? 'you@company.com' : 'Work'}</Text>
  }

  return (
    <Box flexDirection="column">
      <Text bold>Add CalDAV account</Text>
      <Text dimColor>Each account is isolated: events and invitations are only sent from the account they belong to.</Text>
      {FIELDS.map((f) => (
        <Text key={f}>
          <Text color={f === v.field ? 'cyan' : undefined}>{`${f === v.field ? '›' : ' '} ${NAMES[f].padEnd(13)}`}</Text>
          {shown(f)}
          {f === v.field && f !== 'provider' && f !== 'color' ? <Text color="cyan">▏</Text> : null}
        </Text>
      ))}
      <Text dimColor>Check your provider's docs if connection fails.</Text>
      {v.busy && <Text color="yellow">Verifying…</Text>}
      {v.error && <Text color="red">{v.error}</Text>}
      <Text dimColor>tab/↑↓ field  ←→ change provider/colour  enter add account  esc back</Text>
    </Box>
  )
}
