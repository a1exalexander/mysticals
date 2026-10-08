import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '@shared/types'

vi.mock('electron', () => ({ ipcMain: {}, shell: {} }))
const { createActivityLog } = await import('./activityLog')

const entry = (at: string, over: Partial<LogEntry> = {}): LogEntry => ({ at, accountId: 'work', email: 'me@work.example', kind: 'sync', ok: true, ...over })
const fresh = () => join(mkdtempSync(join(tmpdir(), 'logs-')), 'logs')

describe('activity log', () => {
  it('lists newest first, filtered by account and kind, with every account seen', () => {
    const log = createActivityLog(fresh())
    const now = new Date()
    const at = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
    log.append(entry(at(3)))
    log.append(entry(at(2), { kind: 'event.delete' }))
    log.append(entry(at(1), { accountId: 'gone', email: 'old@x.example' }))
    expect(log.list({}, now).entries.map((e) => e.at)).toEqual([at(1), at(2), at(3)])
    expect(log.list({ accountId: 'work' }, now).entries).toHaveLength(2)
    expect(log.list({ kinds: ['event.delete'] }, now).entries.map((e) => e.kind)).toEqual(['event.delete'])
    expect(log.list({}, now).accounts).toEqual([
      { id: 'gone', email: 'old@x.example' },
      { id: 'work', email: 'me@work.example' }
    ])
  })

  it('pages with `before` and says when more are left', () => {
    const log = createActivityLog(fresh())
    const now = new Date()
    const ats = [1, 2, 3].map((m) => new Date(now.getTime() - m * 60_000).toISOString())
    for (const at of ats) log.append(entry(at))
    const first = log.list({ limit: 2 }, now)
    expect(first.entries.map((e) => e.at)).toEqual(ats.slice(0, 2))
    expect(first.more).toBe(true)
    const next = log.list({ limit: 2, before: first.entries[1].at }, now)
    expect(next.entries.map((e) => e.at)).toEqual([ats[2]])
    expect(next.more).toBe(false)
  })

  it('skips broken lines, deletes files older than 30 days and keeps files private', () => {
    const dir = fresh()
    const log = createActivityLog(dir)
    const now = new Date()
    log.append(entry(now.toISOString())) // creates the dir
    const today = readdirSync(dir)[0]
    writeFileSync(join(dir, '2000-01-01.jsonl'), `${JSON.stringify(entry('2000-01-01T10:00:00Z'))}\n`)
    writeFileSync(join(dir, today), '{"cut', { flag: 'a' })
    expect(log.list({}, now).entries).toHaveLength(1)
    expect(statSync(join(dir, today)).mode & 0o777).toBe(0o600)
    createActivityLog(dir).append(entry(now.toISOString()))
    expect(readdirSync(dir)).toEqual([today])
  })
})
