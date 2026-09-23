import { useEffect, useRef, useState } from 'react'
import { bus } from '../bus'
import { PRESETS, SWATCHES, Sheet, Swatches, errorText, suggestLabel } from './AccountsShared'

type Step = 'choose' | 'google' | 'caldav'

// Unit 8 owns: add Google / CalDAV account. Listens to bus 'accounts:open'.
export function AccountsHost(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [error, setError] = useState('')
  // Bumped on every open/close so a late Google result can't touch a closed sheet.
  const session = useRef(0)

  useEffect(
    () =>
      bus.on('accounts:open', () => {
        session.current++
        setStep('choose')
        setError('')
        setOpen(true)
      }),
    []
  )

  const close = (): void => {
    session.current++
    setOpen(false)
  }

  // A late result from a previous open must not close a sheet the user reopened.
  const closeIfCurrent = (s: number) => (): void => {
    if (s === session.current) close()
  }

  const addGoogle = async (): Promise<void> => {
    const s = session.current
    setError('')
    setStep('google')
    try {
      await window.api.accounts.addGoogle()
      if (s === session.current) close()
    } catch (e) {
      if (s !== session.current) return
      setError(errorText(e))
      setStep('choose')
    }
  }

  return (
    <Sheet open={open} onClose={close} title="Add calendar account" testId="accounts-sheet">
      <p className="acc-note">
        Each account is isolated: events and invitations are only sent from the account they belong to.
      </p>
      {step === 'choose' && (
        <>
          <div className="acc-choices">
            <button type="button" className="acc-choice" data-testid="add-google" onClick={addGoogle}>
              <span className="acc-choice-icon acc-kind-google">G</span>
              <strong>Google</strong>
              <span>Sign in with your browser</span>
            </button>
            <button type="button" className="acc-choice" data-testid="add-caldav" onClick={() => setStep('caldav')}>
              <span className="acc-choice-icon acc-kind-caldav">DAV</span>
              <strong>CalDAV</strong>
              <span>Private Email, iCloud, Fastmail…</span>
            </button>
          </div>
          {error && <p className="acc-error" role="alert">{error}</p>}
          <button
            type="button"
            className="acc-link"
            data-testid="open-settings"
            onClick={() => {
              close()
              bus.emit('settings:open', {})
            }}
          >
            Manage existing accounts…
          </button>
        </>
      )}
      {step === 'google' && (
        <div className="acc-waiting">
          <span className="acc-spinner" aria-hidden />
          <p>Waiting for Google sign-in in your browser…</p>
          <div className="acc-actions">
            <button type="button" onClick={close}>Cancel</button>
          </div>
        </div>
      )}
      {step === 'caldav' && <CaldavForm onBack={() => setStep('choose')} onDone={closeIfCurrent(session.current)} />}
    </Sheet>
  )
}

function CaldavForm(props: { onBack: () => void; onDone: () => void }): React.JSX.Element {
  const [preset, setPreset] = useState<string>(PRESETS[0].id)
  const [serverUrl, setServerUrl] = useState<string>(PRESETS[0].url)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState('')
  const [labelTouched, setLabelTouched] = useState(false)
  const [color, setColor] = useState(SWATCHES[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await window.api.accounts.addCaldav({
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        password,
        label: label.trim() || username.trim(),
        color
      })
      props.onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="acc-form" onSubmit={submit}>
      <label>
        <span>Provider</span>
        <select
          value={preset}
          onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value)!
            setPreset(p.id)
            setServerUrl(p.url)
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Server URL</span>
        <input
          type="url"
          required
          placeholder="https://caldav.example.com/"
          value={serverUrl}
          onChange={(e) => {
            setServerUrl(e.target.value)
            setPreset('custom')
          }}
        />
      </label>
      <p className="acc-hint">Check your provider's docs if connection fails.</p>
      <label>
        <span>Email</span>
        <input
          type="text"
          required
          autoComplete="username"
          placeholder="you@company.com"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            if (!labelTouched) setLabel(suggestLabel(e.target.value))
          }}
        />
      </label>
      <label>
        <span>App password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        <span>Label</span>
        <input
          type="text"
          placeholder="Work"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value)
            setLabelTouched(true)
          }}
        />
      </label>
      <div className="acc-row">
        <span>Colour</span>
        <Swatches value={color} onChange={setColor} name="Account colour" />
      </div>
      {error && <p className="acc-error" role="alert">{error}</p>}
      <div className="acc-actions">
        <button type="button" onClick={props.onBack} disabled={busy}>Back</button>
        <button type="submit" className="acc-primary" data-testid="add-caldav-submit" disabled={busy}>
          {busy ? 'Connecting…' : 'Add account'}
        </button>
      </div>
    </form>
  )
}
