// User-facing errors that the apps can show in the UI language. The core has no locale of its own, so the error
// carries its message key; `.message` stays the English text for logs and the (English) terminal app.
import { isKey, t, type Key, type Locale, type Params } from './i18n'

/** A message key and its params, as it travels with an error (over IPC, or on an account). */
export interface ErrorKey {
  key: string
  params?: Params
}

export class AppError extends Error {
  constructor(
    readonly key: Key,
    readonly params?: Params
  ) {
    super(t('en', key, params))
  }
}

/** Marks a message that carries an ErrorKey (`wireError`); a control char no real message starts with. */
const MARK = '\u0001i18n'

/**
 * For a boundary that keeps only an error's message (Electron IPC): an AppError becomes an Error whose message carries
 * its key, params and English text. Anything else passes through.
 */
export function wireError(e: unknown): unknown {
  if (!(e instanceof AppError)) return e
  const out = new Error(MARK + JSON.stringify({ key: e.key, params: e.params, text: e.message }))
  out.name = e.name
  return out
}

/** `k` in `locale`, or `fallback` for a key this build doesn't know (an older or newer core sent it). */
export const keyText = (k: ErrorKey, locale: Locale, fallback: string): string =>
  isKey(k.key) ? t(locale, k.key, k.params) : fallback

/**
 * An error's text for the UI, in `locale`: an AppError or a `wireError` message is translated; anything else keeps
 * its message, minus Electron's "Error invoking remote method 'x': Error: " prefix.
 */
export function errorText(e: unknown, locale: Locale = 'en'): string {
  if (e instanceof AppError) return t(locale, e.key, e.params)
  const msg = String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
  if (!msg.startsWith(MARK)) return msg
  try {
    const w = JSON.parse(msg.slice(MARK.length)) as ErrorKey & { text: string }
    return keyText(w, locale, w.text)
  } catch {
    return msg.slice(MARK.length)
  }
}
