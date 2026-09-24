/**
 * Once-a-day npm check for a newer `mysticals`, shown as a hint in the status line.
 * Cached in `<home>/update-check.json`; any failure (offline, slow registry, bad JSON) just means "no hint".
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
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

async function cached(file: string): Promise<{ latest?: string } | undefined> {
  try {
    const c = JSON.parse(await readFile(file, 'utf8')) as { checkedAt?: unknown; latest?: string }
    return typeof c.checkedAt === 'number' && Date.now() - c.checkedAt < DAY_MS ? c : undefined
  } catch {
    return undefined
  }
}

/** The latest published version when it's newer than `current`, else undefined. Never throws; `signal` aborts the fetch. */
export async function checkUpdate(signal?: AbortSignal, current = version): Promise<string | undefined> {
  const registry = process.env.MYSTICALS_UPDATE_REGISTRY
  if (isMock() && !registry) return undefined
  const file = join(homeDir(), 'update-check.json')
  try {
    let latest = (await cached(file))?.latest
    if (latest === undefined) {
      const res = await fetch(`${registry || 'https://registry.npmjs.org'}/mysticals/latest`, {
        signal: AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])])
      })
      if (!res.ok) return undefined
      const v = ((await res.json()) as { version?: unknown }).version
      if (typeof v !== 'string') return undefined
      latest = v
      await mkdir(homeDir(), { recursive: true })
      await writeFile(file, JSON.stringify({ checkedAt: Date.now(), latest }))
    }
    return isNewer(latest, current) ? latest : undefined
  } catch {
    return undefined
  }
}
