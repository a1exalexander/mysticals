import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Account, AccountKind, Calendar, CalEvent, Credentials } from '../shared/types'
import type { CalendarProvider, ProviderFactory } from '../providers/types'

export interface AccountCache {
  calendars: Calendar[]
  events: CalEvent[]
  syncedAt?: string
}

export interface SecretCrypto {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

const ID_RE = /^[a-zA-Z0-9-]{1,64}$/

/** Missing file -> fallback; unparseable file -> throws with the path, so the user knows what to fix. */
function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (e) {
    throw new Error(`Could not read ${file}: ${(e as Error).message}`)
  }
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, file)
}

// Layout: <dir>/accounts.json registry (metadata only); <dir>/accounts/<id>/{creds.bin,cache.json,prefs.json}
export class AccountStore {
  private accounts: Account[]
  private providers = new Map<string, CalendarProvider>()
  /** Parsed cache.json per account; caches can be tens of MB, so they are read from disk once. */
  private caches = new Map<string, AccountCache>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly dir: string,
    readonly factories: Record<AccountKind, ProviderFactory>,
    private readonly crypto: SecretCrypto
  ) {
    // Never fall back to [] here: the next save would wipe every account.
    this.accounts = readJson<Account[]>(this.registryFile, [])
    if (!Array.isArray(this.accounts)) throw new Error(`Could not read ${this.registryFile}: not a list of accounts`)
  }

  private get registryFile(): string {
    return join(this.dir, 'accounts.json')
  }

  /** Validates the id before it ever becomes part of a path (no traversal). */
  private accountDir(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`Invalid account id: ${JSON.stringify(id)}`)
    return join(this.dir, 'accounts', id)
  }

  private require(id: string): Account {
    const acc = this.get(id)
    if (!acc) throw new Error(`Unknown account: ${id}`)
    return acc
  }

  /** All writes run one at a time, so checks and file snapshots never race (e.g. a refresh vs. remove). */
  // ponytail: one queue for all accounts; per-account queues if write throughput ever matters.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => {})
    return run
  }

  private saveRegistry(): Promise<void> {
    return writeAtomic(this.registryFile, JSON.stringify(this.accounts, null, 2))
  }

  private async writeCreds(id: string, creds: Credentials): Promise<void> {
    const dir = this.accountDir(id)
    const data = this.crypto.encrypt(JSON.stringify(creds))
    await mkdir(dir, { recursive: true })
    await writeAtomic(join(dir, 'creds.bin'), data)
  }

  private readCreds(id: string): Credentials {
    return JSON.parse(this.crypto.decrypt(readFileSync(join(this.accountDir(id), 'creds.bin')))) as Credentials
  }

  list(): Account[] {
    return this.accounts.map((a) => ({ ...a }))
  }
  get(id: string): Account | undefined {
    const acc = this.accounts.find((a) => a.id === id)
    return acc && { ...acc }
  }
  async add(meta: Omit<Account, 'id'>, creds: Credentials): Promise<Account> {
    if (creds.kind !== meta.kind) throw new Error('Credentials kind does not match account kind')
    const account: Account = { id: randomUUID(), kind: meta.kind, label: meta.label, email: meta.email, color: meta.color }
    return this.serial(async () => {
      // Creds first: if encryption is unavailable nothing is registered.
      await this.writeCreds(account.id, creds)
      this.accounts.push(account)
      await this.saveRegistry()
      return { ...account }
    })
  }
  async update(
    id: string,
    patch: { label?: string; color?: string; error?: string; credentials?: Credentials }
  ): Promise<Account> {
    return this.serial(async () => {
      const acc = this.accounts.find((a) => a.id === id)
      if (!acc) throw new Error(`Unknown account: ${id}`)
      if (patch.credentials) {
        if (patch.credentials.kind !== acc.kind) throw new Error('Credentials kind does not match account kind')
        await this.writeCreds(id, patch.credentials)
        this.providers.delete(id)
      }
      if (patch.label !== undefined) acc.label = patch.label
      if (patch.color !== undefined) acc.color = patch.color
      if ('error' in patch) {
        if (patch.error) acc.error = patch.error
        else delete acc.error
      }
      await this.saveRegistry()
      return { ...acc }
    })
  }
  /** Removes account and wipes its directory (creds + cache). */
  async remove(id: string): Promise<void> {
    const dir = this.accountDir(id)
    return this.serial(async () => {
      this.providers.delete(id)
      this.caches.delete(id)
      this.accounts = this.accounts.filter((a) => a.id !== id)
      await this.saveRegistry()
      await rm(dir, { recursive: true, force: true })
    })
  }
  /** Isolated provider instance for this account only (memoized per account). */
  getProvider(id: string): CalendarProvider {
    const cached = this.providers.get(id)
    if (cached) return cached
    const acc = this.require(id)
    const provider = this.factories[acc.kind]({
      accountId: acc.id,
      email: acc.email,
      credentials: this.readCreds(acc.id),
      // Bound to this account only; a no-op once the account is removed (never resurrects its dir).
      saveCredentials: (creds) =>
        this.serial(async () => {
          if (this.providers.get(acc.id) !== provider) return
          if (creds.kind !== acc.kind) throw new Error('Credentials kind does not match account kind')
          await this.writeCreds(acc.id, creds)
        })
    })
    this.providers.set(id, provider)
    return provider
  }
  readCache(id: string): AccountCache {
    const hit = this.caches.get(id)
    if (hit) return hit
    const cache = readJson<AccountCache>(join(this.accountDir(id), 'cache.json'), { calendars: [], events: [] })
    if (this.get(id)) this.caches.set(id, cache)
    return cache
  }
  writeCache(id: string, cache: AccountCache): Promise<void> {
    return this.serial(async () => {
      const dir = this.accountDir(id)
      this.require(id)
      await mkdir(dir, { recursive: true })
      await writeAtomic(join(dir, 'cache.json'), JSON.stringify(cache))
      this.caches.set(id, cache)
    })
  }
  /** In-memory only: shows a local edit at once; the next sync writes the server's copy to disk. */
  patchCache(id: string, fn: (cache: AccountCache) => AccountCache): void {
    this.require(id)
    this.caches.set(id, fn(this.readCache(id)))
  }
  hiddenCalendars(id: string): string[] {
    // Prefs are only calendar visibility: a corrupt file just shows everything again (rewritten on the next toggle).
    const file = join(this.accountDir(id), 'prefs.json')
    try {
      const hidden = readJson<{ hidden?: unknown }>(file, {}).hidden
      return Array.isArray(hidden) ? hidden.filter((h): h is string => typeof h === 'string') : []
    } catch {
      return []
    }
  }
  setCalendarVisible(id: string, calendarId: string, visible: boolean): Promise<void> {
    return this.serial(async () => {
      this.require(id)
      const hidden = new Set(this.hiddenCalendars(id))
      if (visible) hidden.delete(calendarId)
      else hidden.add(calendarId)
      const dir = this.accountDir(id)
      await mkdir(dir, { recursive: true })
      await writeAtomic(join(dir, 'prefs.json'), JSON.stringify({ hidden: [...hidden] }))
    })
  }
}
