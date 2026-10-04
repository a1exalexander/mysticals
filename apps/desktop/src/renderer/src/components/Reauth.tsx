import { useEffect, useRef, useState } from 'react'
import { bus } from '../bus'
import { useCalendarData } from '../hooks/useCalendarData'
import { ConnectSteps, Sheet, errorText } from './AccountsShared'
import { t, useLocale } from '../i18n'

/**
 * "<account> is disconnected": the server rejected its credentials (`authError`).
 * Opens by itself once each time an account becomes disconnected, and on bus 'reauth:open'.
 */
export function ReauthHost(): React.JSX.Element | null {
  const { accounts } = useCalendarData()
  useLocale()
  const [id, setId] = useState<string>()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Accounts already prompted for, so a dismissed prompt doesn't come back on every reload.
  const prompted = useRef(new Set<string>())
  const input = useRef<HTMLInputElement>(null)
  // Bumped on every open: a reconnect still running from an earlier prompt must not touch this one.
  const session = useRef(0)

  const open = (accountId: string): void => {
    session.current++
    setId(accountId)
    setPassword('')
    setError('')
    setBusy(false)
  }

  useEffect(() => bus.on('reauth:open', ({ accountId }) => open(accountId)), [])

  useEffect(() => {
    for (const a of accounts) if (!a.authError) prompted.current.delete(a.id)
    if (id !== undefined) return
    const next = accounts.find((a) => a.authError && !prompted.current.has(a.id))
    if (next) {
      prompted.current.add(next.id)
      open(next.id)
    }
  }, [accounts, id])

  const a = accounts.find((x) => x.id === id)
  // After the Sheet's showModal (child effects run first), which would focus the close button.
  useEffect(() => input.current?.focus(), [id, !!a])
  // Closable while busy too: an abandoned Google sign-in in the browser never settles.
  const close = (): void => {
    session.current++
    setId(undefined)
  }

  const reconnect = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    if (!a) return
    const s = session.current
    setBusy(true)
    setError('')
    try {
      await window.api.accounts.reauth(a.id, a.kind === 'caldav' ? { password } : undefined)
      bus.emit('toast', { text: t('reauth.done', { label: a.label }) })
      if (s === session.current) close()
    } catch (err) {
      if (s === session.current) setError(errorText(err))
    } finally {
      if (s === session.current) setBusy(false)
    }
  }

  if (!a) return null
  return (
    <Sheet open onClose={close} title={t('reauth.title', { label: a.label })} testId="reauth-sheet">
      <p className="acc-note">
        {t(a.kind === 'google' ? 'reauth.google' : 'reauth.caldav', { email: a.email })}
        <br />
        {t('reauth.stayVisible')}
      </p>
      {busy && (
        <ConnectSteps
          testId="reauth-connecting"
          steps={[a.kind === 'google' ? t('accounts.google.waiting') : t('reauth.signingIn'), t('accounts.step.loadingCalendars')]}
          active={0}
        />
      )}
      <form className="acc-form" onSubmit={reconnect}>
        {a.kind === 'caldav' && (
          <div className="acc-form-fields" hidden={busy}>
            <label>
              <span>{t('accounts.field.password')}</span>
              <input
                type="password"
                required
                ref={input}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
        )}
        {error && (
          <p className="acc-error" role="alert">
            {error}
          </p>
        )}
        <div className="acc-actions" hidden={busy}>
          <button type="button" onClick={close}>
            {t('reauth.later')}
          </button>
          <button type="submit" className="acc-primary" data-testid="reauth-submit">
            {a.kind === 'google' ? t('reauth.signInAgain') : t('settings.reconnect')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
