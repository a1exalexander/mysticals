import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkUpdate, isNewer } from './update'

describe('isNewer', () => {
  it('compares x.y.z numerically', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('0.1.0', '0.1.1')).toBe(false)
  })
})

describe('checkUpdate', () => {
  let home: string
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: '9.9.9' })))
  const cache = (): string => join(home, 'update-check.json')

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mysticals-upd-'))
    vi.stubEnv('MYSTICALS_HOME', home)
    vi.stubEnv('MYSTICALS_MOCK', '')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('fetches when there is no cache, then writes it', async () => {
    expect(await checkUpdate(undefined, '0.1.0')).toBe('9.9.9')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(readFileSync(cache(), 'utf8')).latest).toBe('9.9.9')
  })

  it('uses a fresh cache without fetching', async () => {
    writeFileSync(cache(), JSON.stringify({ checkedAt: Date.now() - 3600_000, latest: '0.3.0' }))
    expect(await checkUpdate(undefined, '0.1.0')).toBe('0.3.0')
    expect(await checkUpdate(undefined, '0.3.0')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refetches a stale cache', async () => {
    writeFileSync(cache(), JSON.stringify({ checkedAt: Date.now() - 25 * 3600_000, latest: '0.3.0' }))
    expect(await checkUpdate(undefined, '0.1.0')).toBe('9.9.9')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('swallows network errors and skips mock mode', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await checkUpdate(undefined, '0.1.0')).toBeUndefined()
    vi.stubEnv('MYSTICALS_MOCK', '1')
    expect(await checkUpdate(undefined, '0.1.0')).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
