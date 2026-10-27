import { describe, expect, it } from 'vitest'
import { AppError, errorText, keyText, wireError } from './errors'
import { AuthError, TimeoutError } from './providers/http'

/** What the renderer gets when a main-process handler throws `e` (Electron keeps only the message). */
const overIpc = (e: unknown): Error => new Error(`Error invoking remote method 'events:update': Error: ${(wireError(e) as Error).message}`)

describe('AppError', () => {
  it('keeps the English text as its message, for logs and the terminal', () => {
    expect(new AppError('error.readOnly').message).toBe('calendar is read-only')
    expect(new AuthError('error.caldav.wrongPassword').message).toBe('CalDAV login failed: wrong username or password')
    expect(new TimeoutError('error.timeout', { host: 'dav.example.com' }).message).toBe('Request to dav.example.com timed out')
    expect(new AppError('error.caldav.noEmail').message).toBe('Could not determine the account email; use your full email address as the username')
  })
  it('subclasses stay recognisable', () => {
    const e = new AuthError('error.google.rejected')
    expect(e).toBeInstanceOf(AuthError)
    expect(e).toBeInstanceOf(AppError)
    expect(e.name).toBe('AuthError')
  })
})

describe('errorText', () => {
  it('translates a core error, directly or after Electron flattened it', () => {
    const e = new AppError('error.repeatScope')
    expect(errorText(e, 'uk')).toBe('Правило повторення належить усій серії: виберіть «Ця й наступні» або «Усі події»')
    expect(errorText(overIpc(e), 'uk')).toBe(errorText(e, 'uk'))
    expect(errorText(overIpc(e), 'en')).toBe(e.message)
    expect(errorText(overIpc(e))).toBe(e.message) // the terminal's default
  })
  it('fills params in the target language', () => {
    const e = new AppError('error.caldav.updateFailed', { status: '500 Internal Server Error' })
    expect(errorText(overIpc(e), 'uk')).toBe('Не вдалося змінити подію: 500 Internal Server Error')
  })
  it('falls back to the English text for a key this build does not know', () => {
    const wire = `\u0001i18n${JSON.stringify({ key: 'error.fromTheFuture', text: 'Something new failed' })}`
    expect(errorText(new Error(`Error invoking remote method 'x': Error: ${wire}`), 'uk')).toBe('Something new failed')
    expect(keyText({ key: 'error.fromTheFuture' }, 'uk', 'fallback')).toBe('fallback')
  })
  it('leaves other errors as they are, minus the IPC prefix', () => {
    expect(wireError(new Error('plain'))).toBeInstanceOf(Error)
    expect(errorText(new Error("Error invoking remote method 'accounts:addCaldav': Error: Not available in mock mode"), 'uk')).toBe(
      'Not available in mock mode'
    )
    expect(errorText('boom', 'uk')).toBe('boom')
  })
})
