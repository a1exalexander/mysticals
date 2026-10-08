import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { format, subDays } from 'date-fns'
import { z } from 'zod'
import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { LogEntry, LogPage, LogQuery } from '@shared/types'

/** Days of history kept; older daily files are deleted. */
export const KEEP_DAYS = 30
const FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/
const day = (d: Date): string => format(d, 'yyyy-MM-dd')

const Query = z
  .object({
    accountId: z.string().max(1024).optional(),
    kinds: z.array(z.string().max(64)).max(32).optional(),
    before: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(1000).optional()
  })
  .strict()

export interface ActivityLog {
  append(entry: LogEntry): void
  list(q?: LogQuery, now?: Date): LogPage
  readonly dir: string
}

/**
 * Settings > Logs: one JSON line per entry in `<dir>/YYYY-MM-DD.jsonl` (local day), readable only by the user. Local
 * only, never sent anywhere. Writing never throws: a full disk must not break sync or the action being logged.
 */
export function createActivityLog(dir: string, onAppend?: () => void): ActivityLog {
  let pruned = ''
  const files = (): string[] => {
    try {
      return readdirSync(dir).filter((f) => FILE.test(f))
    } catch {
      return []
    }
  }
  const prune = (now: Date): void => {
    const oldest = day(subDays(now, KEEP_DAYS))
    for (const f of files()) if (f.slice(0, 10) < oldest) rmSync(join(dir, f), { force: true })
  }

  return {
    dir,
    append(entry) {
      try {
        const now = new Date()
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        if (pruned !== day(now)) {
          prune(now)
          pruned = day(now)
        }
        appendFileSync(join(dir, `${day(new Date(entry.at))}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
        onAppend?.()
      } catch (e) {
        console.error('activity log write failed', e)
      }
    },
    list(raw = {}, now = new Date()) {
      const q = Query.parse(raw)
      const limit = q.limit ?? 200
      const since = subDays(now, KEEP_DAYS).toISOString()
      const kinds = q.kinds?.length ? new Set(q.kinds) : undefined
      const accounts = new Map<string, string>()
      const entries: LogEntry[] = []
      for (const f of files().sort().reverse()) {
        let text: string
        try {
          text = readFileSync(join(dir, f), 'utf8')
        } catch {
          continue
        }
        const lines = text.split('\n')
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i]) continue
          let e: LogEntry
          try {
            e = JSON.parse(lines[i])
          } catch {
            continue // a line cut by a crash
          }
          if (typeof e?.at !== 'string' || e.at < since) continue
          if (e.accountId && !accounts.has(e.accountId)) accounts.set(e.accountId, e.email)
          if (q.accountId !== undefined && e.accountId !== q.accountId) continue
          if (kinds && !kinds.has(e.kind)) continue
          if (q.before && e.at >= q.before) continue
          entries.push(e)
        }
      }
      // Lines are in write order; entries of one day may come from a clock that jumped.
      entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      return { entries: entries.slice(0, limit), accounts: [...accounts].map(([id, email]) => ({ id, email })), more: entries.length > limit }
    }
  }
}

/** `window.logs` handlers. */
export function registerActivityLog(log: ActivityLog): void {
  ipcMain.handle(IPC.logsList, (_e, q: unknown) => log.list(q as LogQuery))
  ipcMain.handle(IPC.logsOpen, async () => {
    mkdirSync(log.dir, { recursive: true, mode: 0o700 })
    const error = await shell.openPath(log.dir)
    if (error) throw new Error(error)
  })
}
