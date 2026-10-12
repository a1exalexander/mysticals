import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { Effect, type FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { loadPrefs, readPrefs, writePrefs } from './prefs'

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>): Promise<A> => Effect.runPromise(Effect.provide(effect, NodeFileSystem.layer))

describe('prefs', () => {
  it('keeps the other settings when one changes, on disk too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-'))
    await run(loadPrefs(dir))
    expect(readPrefs()).toEqual({})
    await run(writePrefs({ telemetry: false }))
    await run(writePrefs({ language: 'uk' }))
    expect(readPrefs()).toEqual({ telemetry: false, language: 'uk' })
    await Promise.all([run(writePrefs({ telemetry: true })), run(writePrefs({ reminderMin: 5 }))])
    expect(JSON.parse(readFileSync(join(dir, 'prefs.json'), 'utf8'))).toEqual({ telemetry: true, language: 'uk', reminderMin: 5 })
    await run(loadPrefs(dir))
    expect(readPrefs()).toEqual({ telemetry: true, language: 'uk', reminderMin: 5 })
  })

  it('treats a broken file as defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-'))
    writeFileSync(join(dir, 'prefs.json'), '{"cut')
    await run(loadPrefs(dir))
    expect(readPrefs()).toEqual({})
  })
})
