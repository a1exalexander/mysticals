import { startTelemetry } from '@mysticals/core/telemetry'
import { version } from '../package.json'
import { homeDir } from './paths'

// Injected by tsup `define` from MYSTICALS_POSTHOG_KEY at build time; empty (telemetry off) when unset.
declare const __POSTHOG_KEY__: string

/** Shown once in the status line on the run that sent `app_installed`. */
export const TELEMETRY_NOTICE = 'Anonymous usage stats: 2 events · opt out: MYSTICALS_TELEMETRY=0 · mysticals.sashkoratushnyi.com/privacy'

/** See core `startTelemetry`; env opt-outs (DO_NOT_TRACK, MYSTICALS_TELEMETRY=0, mock) are the terminal's only switch. */
export const telemetry = (): ReturnType<typeof startTelemetry> =>
  startTelemetry({ key: typeof __POSTHOG_KEY__ === 'string' ? __POSTHOG_KEY__ : '', app: 'terminal', version, dir: homeDir() })
