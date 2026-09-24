/**
 * Anonymous opt-out usage stats: exactly two PostHog events, `app_installed` (once per install) and `account_added`.
 * Only app, version, os, arch and (for account_added) provider + CalDAV preset are sent; the distinct_id is a random
 * UUID kept in the app's data dir. Fire-and-forget: every failure is swallowed and nothing ever waits on it.
 */
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const HOST = 'https://eu.i.posthog.com'

/** Props of `account_added`; `preset` only for CalDAV (see `caldavPreset`). */
export interface AccountAdded {
  provider: 'google' | 'caldav'
  preset?: string
}

export type Track = (event: 'app_installed' | 'account_added', props?: AccountAdded) => void

export interface TelemetryOptions {
  /** PostHog project key embedded at build (MYSTICALS_POSTHOG_KEY); empty means off. */
  key: string | undefined
  app: 'desktop' | 'terminal'
  version: string
  /** App data dir; holds the random install id (`telemetry-id`). */
  dir: string
  /** Extra switch read on every event (desktop Settings toggle). */
  allowed?: () => boolean
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

/** DO_NOT_TRACK (any value but 0/false, per consoledonottrack.com), MYSTICALS_TELEMETRY=0/false, or mock mode. */
export function telemetryOff(env: NodeJS.ProcessEnv = process.env): boolean {
  const no = (v?: string): boolean => v === '0' || v?.toLowerCase() === 'false'
  return (!!env.DO_NOT_TRACK && !no(env.DO_NOT_TRACK)) || no(env.MYSTICALS_TELEMETRY) || env.MYSTICALS_MOCK === '1'
}

// Built-in CalDAV presets of both apps, by server host; any other server is 'custom' (its URL is never sent).
const PRESETS: Record<string, string> = {
  'dav.privateemail.com': 'privateemail',
  'caldav.icloud.com': 'icloud',
  'caldav.fastmail.com': 'fastmail'
}
export const caldavPreset = (serverUrl: string): string => PRESETS[new URL(serverUrl).hostname] ?? 'custom'

/** Reads the install id, creating it on first run (`fresh`). */
function installId(dir: string): { id: string; fresh: boolean } {
  const file = join(dir, 'telemetry-id')
  try {
    const id = readFileSync(file, 'utf8').trim()
    if (id) return { id, fresh: false }
  } catch {
    // first run
  }
  const id = randomUUID()
  mkdirSync(dir, { recursive: true, mode: 0o700 }) // the terminal's home is private (see its daemon)
  writeFileSync(file, id)
  return { id, fresh: true }
}

/**
 * Undefined when telemetry is off; otherwise `track` plus whether this run created the install id,
 * in which case `app_installed` was just sent. Never throws.
 */
export function startTelemetry(o: TelemetryOptions): { track: Track; installed: boolean } | undefined {
  const env = o.env ?? process.env
  if (!o.key || telemetryOff(env)) return undefined
  let install: { id: string; fresh: boolean }
  try {
    install = installId(o.dir)
  } catch {
    return undefined // unwritable data dir: no stable id, so no stats
  }
  // Dev-only override for local capture servers (tests, e2e).
  const host = env.MYSTICALS_TELEMETRY_HOST || HOST
  const doFetch = o.fetch ?? fetch
  const track: Track = (event, props) => {
    if (o.allowed && !o.allowed()) return
    const properties = {
      app: o.app,
      version: o.version,
      os: process.platform,
      arch: process.arch,
      ...(props && { provider: props.provider, ...(props.preset && { preset: props.preset }) }),
      $process_person_profiles: false,
      $geoip_disable: true
    }
    try {
      doFetch(`${host}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: o.key, event, distinct_id: install.id, properties }),
        // Never aborted early: the install id already exists, so a cancelled app_installed would never be resent.
        signal: AbortSignal.timeout(5000)
      }).catch(() => {})
    } catch {
      // a throwing fetch stub; never matters
    }
  }
  if (install.fresh) track('app_installed')
  return { track, installed: install.fresh }
}
