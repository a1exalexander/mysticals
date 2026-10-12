import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
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
  it('writes atomically (no temp files left) and serves reads from memory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-'))
    writePrefs({ reminderMin: 5 }, dir)
    expect(readdirSync(dir)).toEqual(['prefs.json'])
    expect(JSON.parse(readFileSync(join(dir, 'prefs.json'), 'utf8'))).toEqual({ reminderMin: 5 })
    writeFileSync(join(dir, 'prefs.json'), '{"reminderMin": 9}') // outside edits are not re-read
    expect(readPrefs(dir)).toEqual({ reminderMin: 5 })
    const copy = readPrefs(dir)
    copy.reminderMin = 1 // callers get a copy
    expect(readPrefs(dir)).toEqual({ reminderMin: 5 })
  })
})
