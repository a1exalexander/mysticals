import { useEffect, useRef } from 'react'
import './Accounts.css'

/** Dracula accents: purple, green, cyan, pink, orange, yellow, red, comment. */
export const SWATCHES = ['#bd93f9', '#50fa7b', '#8be9fd', '#ff79c6', '#ffb86c', '#f1fa8c', '#ff5555', '#6272a4']

export const PRESETS = [
  { id: 'privateemail', name: 'Private Email', url: 'https://dav.privateemail.com/dav.php/' },
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

/** Strips Electron's "Error invoking remote method 'x': Error: " prefix. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}

export function Sheet(props: {
  open: boolean
  onClose: () => void
  title: string
  testId: string
  children: React.ReactNode
}): React.JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (props.open && d && !d.open) d.showModal()
  }, [props.open])
  if (!props.open) return null
  return (
    <dialog
      ref={ref}
      className="acc-sheet"
      data-testid={props.testId}
      aria-label={props.title}
      onCancel={(e) => {
        e.preventDefault()
        props.onClose()
      }}
    >
      <header className="acc-sheet-head">
        <h2>{props.title}</h2>
        <button type="button" className="acc-close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>
      {props.children}
    </dialog>
  )
}

export function Swatches(props: { value: string; onChange: (c: string) => void; name: string }): React.JSX.Element {
  return (
    <div className="acc-swatches" role="radiogroup" aria-label={props.name}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={props.value === c}
          aria-label={c}
          className="acc-swatch"
          style={{ background: c }}
          onClick={() => props.onChange(c)}
        />
      ))}
    </div>
  )
}

/** Progress of connecting a new account: done ✓, the active one spins, the rest wait. */
export function ConnectSteps(props: { steps: string[]; active: number; testId?: string }): React.JSX.Element {
  return (
    <div className="acc-waiting" role="status" data-testid={props.testId}>
      <ol className="acc-steps">
        {props.steps.map((s, i) => (
          <li key={s} className={i < props.active ? 'done' : i === props.active ? 'active' : undefined}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Host part of a server URL, for "Connecting to caldav.icloud.com…". */
export const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).host : url)

export function KindIcon({ kind }: { kind: 'google' | 'caldav' }): React.JSX.Element {
  return (
    <span className={`acc-kind acc-kind-${kind}`} title={kind === 'google' ? 'Google' : 'CalDAV'}>
      {kind === 'google' ? 'G' : 'DAV'}
    </span>
  )
}
