import { randomUUID } from 'crypto'
import { join } from 'path'
import { Context, Effect, FileSystem, Layer, Semaphore } from 'effect'
import type { Account, AccountKind, Calendar, CalEvent, Credentials } from '../shared/types'
import type { CalendarProvider, ProviderFactory } from '../providers/types'
import { AppError, fail, messageOf, type ProviderError } from '../errors'

export interface AccountCache {
  calendars: Calendar[]
  events: CalEvent[]
  syncedAt?: string
}

/** Encrypts credentials at rest (desktop: OS safeStorage; terminal: AES with a key in the OS key store). */
export class SecretCrypto extends Context.Service<
  SecretCrypto,
  {
    encrypt(plain: string): Effect.Effect<Uint8Array, AppError>
    decrypt(data: Uint8Array): Effect.Effect<string, AppError>
  }
>()('mysticals/SecretCrypto') {}

export type AccountPatch = { label?: string; color?: string; error?: string; authError?: boolean; credentials?: Credentials }

export interface AccountStoreShape {
  readonly dir: string
  list(): Effect.Effect<Account[]>
  get(id: string): Effect.Effect<Account | undefined>
  /** Decrypted credentials; main/daemon only (accounts.reauth keeps the server and username), never to the renderer. */
  readCreds(id: string): Effect.Effect<Credentials, AppError>
  add(meta: Omit<Account, 'id'>, creds: Credentials): Effect.Effect<Account, AppError>
  update(id: string, patch: AccountPatch): Effect.Effect<Account, AppError>
  /** Removes account and wipes its directory (creds + cache). */
  remove(id: string): Effect.Effect<void, AppError>
  /** Isolated provider instance for this account only (memoized per account). */
  getProvider(id: string): Effect.Effect<CalendarProvider, ProviderError>
  readCache(id: string): Effect.Effect<AccountCache, AppError>
  writeCache(id: string, cache: AccountCache): Effect.Effect<void, AppError>
  /** In-memory only: shows a local edit at once; the next sync writes the server's copy to disk. */
  patchCache(id: string, fn: (cache: AccountCache) => AccountCache): Effect.Effect<void, AppError>
  hiddenCalendars(id: string): Effect.Effect<string[], AppError>
  setCalendarVisible(id: string, calendarId: string, visible: boolean): Effect.Effect<void, AppError>
}

export class AccountStore extends Context.Service<AccountStore, AccountStoreShape>()('mysticals/AccountStore') {
  static readonly layer = (dir: string, factories: Record<AccountKind, ProviderFactory>) =>
    Layer.effect(AccountStore, makeAccountStore(dir, factories))
}

const ID_RE = /^[a-zA-Z0-9-]{1,64}$/

/** Writes to a temp file then renames, so a crash never leaves a half-written file. */
export const writeAtomic = (file: string, data: string | Uint8Array): Effect.Effect<void, AppError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmp = `${file}.${randomUUID()}.tmp`
    yield* typeof data === 'string' ? fs.writeFileString(tmp, data, { mode: 0o600 }) : fs.writeFile(tmp, data, { mode: 0o600 })
    yield* fs.rename(tmp, file)
  }).pipe(Effect.mapError((e) => (e instanceof AppError ? e : fail(messageOf(e)))))

/** Missing file -> fallback; unparseable file -> fails with the path, so the user knows what to fix. */
export const readJson = <T>(file: string, fallback: T): Effect.Effect<T, AppError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (!(yield* fs.exists(file))) return fallback
    const text = yield* fs.readFileString(file)
    return yield* Effect.try(() => JSON.parse(text) as T)
  }).pipe(Effect.mapError((e) => fail(`Could not read ${file}: ${messageOf(e)}`)))

// Layout: <dir>/accounts.json registry (metadata only); <dir>/accounts/<id>/{creds.bin,cache.json,prefs.json}
export const makeAccountStore = (
  dir: string,
  factories: Record<AccountKind, ProviderFactory>
): Effect.Effect<AccountStoreShape, AppError, FileSystem.FileSystem | SecretCrypto> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const crypto = yield* SecretCrypto
    const provideFs = Effect.provideService(FileSystem.FileSystem, fs)
    const registryFile = join(dir, 'accounts.json')

    // Never fall back to [] here: the next save would wipe every account.
    let accounts = yield* provideFs(readJson<Account[]>(registryFile, []))
    if (!Array.isArray(accounts)) return yield* fail(`Could not read ${registryFile}: not a list of accounts`)

    const providers = new Map<string, CalendarProvider>()
    /** Parsed cache.json per account; caches can be tens of MB, so they are read from disk once. */
    const caches = new Map<string, AccountCache>()
    /** prefs.json per account: read on every events.list otherwise. */
    const hidden = new Map<string, string[]>()

    // Writes of one account run one at a time, so checks and file snapshots never race (e.g. a refresh vs. remove);
    // other accounts don't wait. The registry has its own lock, always taken inside an account's.
    const registryLock = yield* Semaphore.make(1)
    const locks = new Map<string, Semaphore.Semaphore>()
    const serial = <A, E, R>(id: string, self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.suspend(() => {
        let lock = locks.get(id)
        if (!lock) locks.set(id, (lock = Semaphore.makeUnsafe(1)))
        return Semaphore.withPermit(lock, self)
      })

    /** Validates the id before it ever becomes part of a path (no traversal). */
    const accountDir = (id: string): Effect.Effect<string, AppError> =>
      ID_RE.test(id) ? Effect.succeed(join(dir, 'accounts', id)) : Effect.fail(fail(`Invalid account id: ${JSON.stringify(id)}`))

    const find = (id: string): Account | undefined => accounts.find((a) => a.id === id)
    const require = (id: string): Effect.Effect<Account, AppError> =>
      Effect.suspend(() => {
        const acc = find(id)
        return acc ? Effect.succeed(acc) : Effect.fail(fail(`Unknown account: ${id}`))
      })

    const io = <A, E>(self: Effect.Effect<A, E, FileSystem.FileSystem>): Effect.Effect<A, AppError> =>
      provideFs(self).pipe(Effect.mapError((e) => (e instanceof AppError ? e : fail(messageOf(e)))))

    const saveRegistry = Semaphore.withPermit(
      registryLock,
      Effect.suspend(() => provideFs(writeAtomic(registryFile, JSON.stringify(accounts, null, 2))))
    )

    const writeCreds = (id: string, creds: Credentials): Effect.Effect<void, AppError> =>
      Effect.gen(function* () {
        const d = yield* accountDir(id)
        const data = yield* crypto.encrypt(JSON.stringify(creds))
        yield* io(fs.makeDirectory(d, { recursive: true }))
        yield* provideFs(writeAtomic(join(d, 'creds.bin'), data))
      })

    const readCreds = (id: string): Effect.Effect<Credentials, AppError> =>
      Effect.gen(function* () {
        const d = yield* accountDir(id)
        const data = yield* io(fs.readFile(join(d, 'creds.bin')))
        return JSON.parse(yield* crypto.decrypt(data)) as Credentials
      })

    const kindMatches = (acc: Account, creds: Credentials): Effect.Effect<void, AppError> =>
      creds.kind === acc.kind ? Effect.void : Effect.fail(fail('Credentials kind does not match account kind'))

    const readCache = (id: string): Effect.Effect<AccountCache, AppError> =>
      Effect.gen(function* () {
        const hit = caches.get(id)
        if (hit) return hit
        const d = yield* accountDir(id)
        const cache = yield* provideFs(readJson<AccountCache>(join(d, 'cache.json'), { calendars: [], events: [] }))
        if (find(id) && !caches.has(id)) caches.set(id, cache)
        return caches.get(id) ?? cache
      })

    const hiddenCalendars = (id: string): Effect.Effect<string[], AppError> =>
      Effect.gen(function* () {
        const hit = hidden.get(id)
        if (hit) return hit
        const d = yield* accountDir(id)
        // Prefs are only calendar visibility: a corrupt file just shows everything again (rewritten on the next toggle).
        const prefs = yield* provideFs(readJson<{ hidden?: unknown }>(join(d, 'prefs.json'), {})).pipe(Effect.orElseSucceed(() => ({ hidden: [] })))
        const list = Array.isArray(prefs.hidden) ? prefs.hidden.filter((h): h is string => typeof h === 'string') : []
        if (find(id)) hidden.set(id, list)
        return list
      })

    const store: AccountStoreShape = {
      dir,
      list: () => Effect.sync(() => accounts.map((a) => ({ ...a }))),
      get: (id) =>
        Effect.sync(() => {
          const acc = find(id)
          return acc && { ...acc }
        }),
      readCreds,

      add: (meta, creds) =>
        Effect.gen(function* () {
          if (creds.kind !== meta.kind) return yield* fail('Credentials kind does not match account kind')
          const account: Account = { id: randomUUID(), kind: meta.kind, label: meta.label, email: meta.email, color: meta.color }
          return yield* serial(
            account.id,
            Effect.gen(function* () {
              // Creds first: if encryption is unavailable nothing is registered.
              yield* writeCreds(account.id, creds)
              accounts = [...accounts, account]
              yield* saveRegistry
              return { ...account }
            })
          )
        }),

      update: (id, patch) =>
        serial(
          id,
          Effect.gen(function* () {
            const acc = yield* require(id)
            if (patch.credentials) {
              yield* kindMatches(acc, patch.credentials)
              yield* writeCreds(id, patch.credentials)
              providers.delete(id)
            }
            if (patch.label !== undefined) acc.label = patch.label
            if (patch.color !== undefined) acc.color = patch.color
            if ('error' in patch) {
              if (patch.error) acc.error = patch.error
              else delete acc.error
            }
            if ('authError' in patch) {
              if (patch.authError) acc.authError = true
              else delete acc.authError
            }
            yield* saveRegistry
            return { ...acc }
          })
        ),

      remove: (id) =>
        Effect.gen(function* () {
          const d = yield* accountDir(id)
          yield* serial(
            id,
            Effect.gen(function* () {
              providers.delete(id)
              caches.delete(id)
              hidden.delete(id)
              accounts = accounts.filter((a) => a.id !== id)
              yield* saveRegistry
              yield* io(fs.remove(d, { recursive: true, force: true }))
            })
          )
        }),

      getProvider: (id) =>
        Effect.suspend(() => {
          const cached = providers.get(id)
          if (cached) return Effect.succeed(cached)
          return serial(
            id,
            Effect.gen(function* () {
              const again = providers.get(id)
              if (again) return again
              const acc = yield* require(id)
              const provider: CalendarProvider = yield* factories[acc.kind]({
                accountId: acc.id,
                email: acc.email,
                credentials: yield* readCreds(acc.id),
                // Bound to this account only; a no-op once the account is removed (never resurrects its dir).
                saveCredentials: (creds) =>
                  serial(
                    acc.id,
                    Effect.gen(function* () {
                      if (providers.get(acc.id) !== provider) return
                      yield* kindMatches(acc, creds)
                      yield* writeCreds(acc.id, creds)
                    })
                  )
              })
              providers.set(id, provider)
              return provider
            })
          )
        }),

      readCache,

      writeCache: (id, cache) =>
        serial(
          id,
          Effect.gen(function* () {
            const d = yield* accountDir(id)
            yield* require(id)
            yield* io(fs.makeDirectory(d, { recursive: true }))
            yield* provideFs(writeAtomic(join(d, 'cache.json'), JSON.stringify(cache)))
            caches.set(id, cache)
          })
        ),

      patchCache: (id, fn) =>
        Effect.gen(function* () {
          yield* require(id)
          caches.set(id, fn(yield* readCache(id)))
        }),

      hiddenCalendars,

      setCalendarVisible: (id, calendarId, visible) =>
        serial(
          id,
          Effect.gen(function* () {
            yield* require(id)
            const next = new Set(yield* hiddenCalendars(id))
            if (visible) next.delete(calendarId)
            else next.add(calendarId)
            const d = yield* accountDir(id)
            yield* io(fs.makeDirectory(d, { recursive: true }))
            yield* provideFs(writeAtomic(join(d, 'prefs.json'), JSON.stringify({ hidden: [...next] })))
            hidden.set(id, [...next])
          })
        )
    }
    return store
  })
