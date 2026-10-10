import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth } from './sidebar'

// sidebar.ts reads the stored width at import, so each case stubs storage before a fresh import.
const storedWidth = async (stored: string | null): Promise<number> => {
  vi.stubGlobal('localStorage', { getItem: () => stored, setItem: () => {} })
  vi.resetModules()
  // Outside React the hook just hands back its snapshot.
  vi.doMock('react', () => ({ useSyncExternalStore: (_: unknown, get: () => number) => get() }))
  const { useSidebarWidth } = await import('./sidebar')
  return useSidebarWidth()
}

describe('sidebar width', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('clamps to whole pixels within bounds', () => {
    expect(clampSidebarWidth(321.6)).toBe(322)
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN)
    expect(clampSidebarWidth(9000)).toBe(SIDEBAR_MAX)
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_DEFAULT)
  })

  it('reads the stored width, falling back to the default', async () => {
    expect(await storedWidth('320')).toBe(320)
    expect(await storedWidth('9000')).toBe(SIDEBAR_MAX)
    expect(await storedWidth('abc')).toBe(SIDEBAR_DEFAULT)
    expect(await storedWidth(null)).toBe(SIDEBAR_DEFAULT)
  })
})
