/**
 * Once-a-day npm check for a newer `mysticals`, shown as a hint in the status line.
 * Cached in `<home>/update-check.json`; any failure (offline, slow registry, bad JSON) just means "no hint".
 */
import { join } from 'path'
import { Clock, Effect, FileSystem } from 'effect'
import { HttpTimeout, request } from '@mysticals/core/providers/http'
import { version } from '../package.json'
import { homeDir, isMock } from './paths'

const DAY_MS = 24 * 3600_000

/** Numeric x.y.z compare; prerelease tags and other suffixes are ignored. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

const cached = (file: string, now: number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(file)
    // Effect.try: a throw inside gen is a defect, which orElseSucceed would not catch.
    const c = (yield* Effect.try(() => JSON.parse(text))) as { checkedAt?: unknown; latest?: string }
    return typeof c.checkedAt === 'number' && now - c.checkedAt < DAY_MS ? c : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))

/** The latest published version when it's newer than `current`, else undefined. Never fails; interrupting it aborts the fetch. */
export const checkUpdate = (current = version): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const registry = process.env.MYSTICALS_UPDATE_REGISTRY
    if (isMock() && !registry) return undefined
    const fs = yield* FileSystem.FileSystem
    const file = join(homeDir(), 'update-check.json')
    const now = yield* Clock.currentTimeMillis
    let latest = (yield* cached(file, now))?.latest
    if (latest === undefined) {
      const v = yield* request(`${registry || 'https://registry.npmjs.org'}/mysticals/latest`, {}, async (res) =>
        res.ok ? ((await res.json()) as { version?: unknown }).version : undefined
      ).pipe(Effect.provideService(HttpTimeout, 3000))
      if (typeof v !== 'string') return undefined
      latest = v
      yield* fs.makeDirectory(homeDir(), { recursive: true })
      yield* fs.writeFileString(file, JSON.stringify({ checkedAt: now, latest }))
    }
    return isNewer(latest, current) ? latest : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))
