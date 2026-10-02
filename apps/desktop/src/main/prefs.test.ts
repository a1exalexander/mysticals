import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))
const { readPrefs, writePrefs } = await import('./prefs')

describe('prefs', () => {
  it('keeps the other settings when one changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-'))
    expect(readPrefs(dir)).toEqual({})
    writePrefs({ telemetry: false }, dir)
    writePrefs({ language: 'uk' }, dir)
    expect(readPrefs(dir)).toEqual({ telemetry: false, language: 'uk' })
    writePrefs({ telemetry: true }, dir)
    expect(readPrefs(dir)).toEqual({ telemetry: true, language: 'uk' })
  })
})
