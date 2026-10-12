import { join } from 'path'
import { format, subDays } from 'date-fns'
import { shell } from 'electron'
import { Cause, Effect, Fiber, FileSystem, Queue, Schema, Semaphore, Stream, type Scope } from 'effect'
import { IPC } from '@shared/ipc'
import type { LogEntry, LogPage } from '@shared/types'
import { AnyArgs, handle } from './ipc/register'

/** Days of history kept; older daily files are deleted. */
export const KEEP_DAYS = 30
const FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/
const day = (d: Date): string => format(d, 'yyyy-MM-dd')

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
const Query = Schema.Struct({
  accountId: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  kinds: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(64))).check(Schema.isMaxLength(32))),
  before: Schema.optional(Schema.String.check(Schema.isPattern(DATE_TIME))),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })))
})
const decodeQuery = Schema.decodeUnknownEffect(Query, { onExcessProperty: 'error' })

export interface ActivityLog {
  /** Queues `entry` for the next batch write; never blocks or throws. */
  append(entry: LogEntry): void
  list(q?: unknown, now?: Date): Effect.Effect<LogPage, Schema.SchemaError>
  readonly dir: string
}

/**
 * Settings > Logs: one JSON line per entry in `<dir>/YYYY-MM-DD.jsonl` (local day), readable only by the user. Local
 * only, never sent anywhere. Writing never fails: a full disk must not break sync or the action being logged.
 * Appends are written in batches (a sync can log hundreds at once); closing the scope writes what is still queued.
 */
export const createActivityLog = (dir: string, onAppend?: () => void): Effect.Effect<ActivityLog, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const queue = yield* Queue.unbounded<LogEntry, Cause.Done>()
    // Parsed entries per day file, so paging the Logs tab does not re-read a month of files; a write drops its files.
    const cache = new Map<string, LogEntry[]>()
    // Writes and reads take turns, so a read never caches a file a write is changing.
    const lock = yield* Semaphore.make(1)
    let pruned = ''

    const files = fs.readDirectory(dir).pipe(
      Effect.map((names) => names.filter((f) => FILE.test(f))),
      Effect.orElseSucceed((): string[] => [])
    )

    const prune = (now: Date) =>
      Effect.gen(function* () {
        const oldest = day(subDays(now, KEEP_DAYS))
        for (const f of yield* files)
          if (f.slice(0, 10) < oldest) {
            cache.delete(f)
            yield* fs.remove(join(dir, f), { force: true })
          }
      })

    const write = (batch: ReadonlyArray<LogEntry>) =>
      Effect.gen(function* () {
        const now = new Date()
        yield* fs.makeDirectory(dir, { recursive: true, mode: 0o700 })
        if (pruned !== day(now)) {
          yield* prune(now)
          pruned = day(now)
        }
        const byFile = new Map<string, string>()
        for (const e of batch) {
          const f = `${day(new Date(e.at))}.jsonl`
          byFile.set(f, `${byFile.get(f) ?? ''}${JSON.stringify(e)}\n`)
        }
        for (const [f, text] of byFile) {
          cache.delete(f)
          yield* fs.writeFileString(join(dir, f), text, { flag: 'a', mode: 0o600 })
        }
        onAppend?.()
      }).pipe(
        Semaphore.withPermit(lock),
        Effect.catchCause((cause) => Effect.sync(() => console.error('activity log write failed', Cause.squash(cause))))
      )

    const drain = yield* Stream.fromQueue(queue).pipe(Stream.groupedWithin(100, '200 millis'), Stream.runForEach(write), Effect.forkScoped)
    // Runs before the drain is interrupted (finalizers run in reverse): ends the queue and waits for the last batch.
    yield* Effect.addFinalizer(() => Queue.end(queue).pipe(Effect.andThen(Fiber.await(drain)), Effect.timeout('2 seconds'), Effect.ignore))

    /** The day file's entries in write order; a line cut by a crash is skipped. Unreadable files are not cached. */
    const read = (f: string): Effect.Effect<LogEntry[]> => {
      const hit = cache.get(f)
      if (hit) return Effect.succeed(hit)
      return fs.readFileString(join(dir, f)).pipe(
        Effect.map((text) => {
          const entries: LogEntry[] = []
          for (const line of text.split('\n')) {
            if (!line) continue
            try {
              const e = JSON.parse(line)
              if (typeof e?.at === 'string') entries.push(e)
            } catch {
              // a line cut by a crash
            }
          }
          cache.set(f, entries)
          return entries
        }),
        Effect.orElseSucceed((): LogEntry[] => [])
      )
    }

    return {
      dir,
      append: (entry) => void Queue.offerUnsafe(queue, entry),
      list: (raw = {}, now = new Date()) =>
        Effect.gen(function* () {
          const q = yield* decodeQuery(raw)
          const limit = q.limit ?? 200
          const since = subDays(now, KEEP_DAYS).toISOString()
          const kinds = q.kinds?.length ? new Set(q.kinds) : undefined
          const accounts = new Map<string, string>()
          const entries: LogEntry[] = []
          for (const f of (yield* files).sort().reverse()) {
            const lines = yield* read(f)
            for (let i = lines.length - 1; i >= 0; i--) {
              const e = lines[i]
              if (e.at < since) continue
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
        }).pipe(Semaphore.withPermit(lock))
    }
  })

/** `window.logs` handlers. */
export const registerActivityLog = (log: ActivityLog) =>
  Effect.gen(function* () {
    yield* handle(IPC.logsList, AnyArgs, ([q]) => log.list(q))
    yield* handle(IPC.logsOpen, AnyArgs, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.makeDirectory(log.dir, { recursive: true, mode: 0o700 })
        const error = yield* Effect.promise(() => shell.openPath(log.dir))
        if (error) return yield* Effect.fail(new Error(error))
      })
    )
  })
