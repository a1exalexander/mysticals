import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { Effect, Exit, Scope } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import type { LogEntry } from '@shared/types'

vi.mock('electron', () => ({ ipcMain: {}, shell: {} }))
const { createActivityLog } = await import('./activityLog')

const entry = (at: string, over: Partial<LogEntry> = {}): LogEntry => ({ at, accountId: 'work', email: 'me@work.example', kind: 'sync', ok: true, ...over })
const fresh = () => join(mkdtempSync(join(tmpdir(), 'logs-')), 'logs')

/** A log plus `flush`, which closes its scope: everything appended so far is on disk after it. */
async function open(dir: string) {
  const scope = Scope.makeUnsafe()
  const log = await Effect.runPromise(createActivityLog(dir).pipe(Scope.provide(scope), Effect.provide(NodeFileSystem.layer)))
  return { log, list: (...a: Parameters<typeof log.list>) => Effect.runPromise(log.list(...a)), flush: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
}

describe('activity log', () => {
  it('lists newest first, filtered by account and kind, with every account seen', async () => {
    const { log, list, flush } = await open(fresh())
    const now = new Date()
    const at = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
    log.append(entry(at(3)))
    log.append(entry(at(2), { kind: 'event.delete' }))
    log.append(entry(at(1), { accountId: 'gone', email: 'old@x.example' }))
    await flush()
    expect((await list({}, now)).entries.map((e) => e.at)).toEqual([at(1), at(2), at(3)])
    expect((await list({ accountId: 'work' }, now)).entries).toHaveLength(2)
    expect((await list({ kinds: ['event.delete'] }, now)).entries.map((e) => e.kind)).toEqual(['event.delete'])
    expect((await list({}, now)).accounts).toEqual([
      { id: 'gone', email: 'old@x.example' },
      { id: 'work', email: 'me@work.example' }
    ])
  })

  it('pages with `before` and says when more are left', async () => {
    const { log, list, flush } = await open(fresh())
    const now = new Date()
    const ats = [1, 2, 3].map((m) => new Date(now.getTime() - m * 60_000).toISOString())
    for (const at of ats) log.append(entry(at))
    await flush()
    const first = await list({ limit: 2 }, now)
    expect(first.entries.map((e) => e.at)).toEqual(ats.slice(0, 2))
    expect(first.more).toBe(true)
    const next = await list({ limit: 2, before: first.entries[1].at }, now)
    expect(next.entries.map((e) => e.at)).toEqual([ats[2]])
    expect(next.more).toBe(false)
  })

  it('writes in batches without waiting for the scope, and sees new entries after a cached read', async () => {
    const { log, list } = await open(fresh())
    const now = new Date()
    log.append(entry(new Date(now.getTime() - 60_000).toISOString()))
    await vi.waitFor(async () => expect((await list({}, now)).entries).toHaveLength(1))
    log.append(entry(now.toISOString()))
    await vi.waitFor(async () => expect((await list({}, now)).entries).toHaveLength(2))
  })

  it('rejects unknown query keys', async () => {
    const { list } = await open(fresh())
    await expect(list({ nope: 1 })).rejects.toThrow()
  })

  it('skips broken lines, deletes files older than 30 days and keeps files private', async () => {
    const dir = fresh()
    const { log, list, flush } = await open(dir)
    const now = new Date()
    log.append(entry(now.toISOString())) // creates the dir
    await flush()
    const today = readdirSync(dir)[0]
    writeFileSync(join(dir, '2000-01-01.jsonl'), `${JSON.stringify(entry('2000-01-01T10:00:00Z'))}\n`)
    writeFileSync(join(dir, today), '{"cut', { flag: 'a' })
    expect((await list({}, now)).entries).toHaveLength(1)
    expect(statSync(join(dir, today)).mode & 0o777).toBe(0o600)
    const next = await open(dir)
    next.log.append(entry(now.toISOString()))
    await next.flush()
    expect(readdirSync(dir)).toEqual([today])
  })
})
