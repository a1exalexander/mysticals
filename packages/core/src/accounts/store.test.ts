import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Effect, type FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Credentials } from '../shared/types'
import type { ProviderContext, ProviderFactory } from '../providers/types'
import { MockProvider } from '../mock/MockProvider'
import { fail } from '../errors'
import { makeAccountStore, SecretCrypto, type AccountStoreShape } from './store'

// Reversible fake "encryption" so tests can assert plaintext never hits disk.
const fakeCrypto: SecretCrypto['Service'] = {
  encrypt: (s) => Effect.succeed(Buffer.from(Buffer.from(s).toString('base64').split('').reverse().join(''))),
  decrypt: (b) => Effect.succeed(Buffer.from(Buffer.from(b).toString().split('').reverse().join(''), 'base64').toString())
}

const run = <A, E>(e: Effect.Effect<A, E, FileSystem.FileSystem | SecretCrypto>, crypto = fakeCrypto): Promise<A> =>
  Effect.runPromise(e.pipe(Effect.provide(NodeFileSystem.layer), Effect.provideService(SecretCrypto, crypto)))

const workCreds: Credentials = { kind: 'caldav', serverUrl: 'https://mail.work.example', username: 'me@work.example', password: 'WORK-SECRET' }
const personalCreds: Credentials = { kind: 'google', refreshToken: 'PERSONAL-REFRESH-SECRET' }

let dir: string
let contexts: ProviderContext[]
let store: AccountStoreShape

function factory(): ProviderFactory {
  return (ctx) => {
    contexts.push(ctx)
    return Effect.succeed(new MockProvider(ctx.accountId, ctx.email, []))
  }
}

const open = (crypto = fakeCrypto): Promise<AccountStoreShape> => run(makeAccountStore(dir, { caldav: factory(), google: factory() }), crypto)

async function addBoth() {
  const work = await run(store.add({ kind: 'caldav', label: 'Work', email: 'me@work.example', color: '#f00' }, workCreds))
  const personal = await run(store.add({ kind: 'google', label: 'Personal', email: 'me@gmail.com', color: '#0f0' }, personalCreds))
  return { work, personal }
}

const accDir = (id: string) => join(dir, 'accounts', id)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mysticals-store-'))
  contexts = []
  store = await open()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('AccountStore isolation', () => {
  it('gives each provider only its own id, email and credentials', async () => {
    const { work, personal } = await addBoth()
    await run(store.getProvider(work.id))
    await run(store.getProvider(personal.id))
    expect(contexts).toHaveLength(2)
    expect(Object.keys(contexts[0]).sort()).toEqual(['accountId', 'credentials', 'email', 'saveCredentials'])
    expect(contexts[0]).toMatchObject({ accountId: work.id, email: 'me@work.example', credentials: workCreds })
    expect(contexts[1]).toMatchObject({ accountId: personal.id, email: 'me@gmail.com', credentials: personalCreds })
  })

  it('memoizes one provider per account', async () => {
    const { work } = await addBoth()
    expect(await run(store.getProvider(work.id))).toBe(await run(store.getProvider(work.id)))
    expect(contexts).toHaveLength(1)
  })

  it("saveCredentials from A only touches A's creds", async () => {
    const { work, personal } = await addBoth()
    await run(store.getProvider(personal.id))
    await run(store.getProvider(work.id))
    const bBefore = readFileSync(join(accDir(work.id), 'creds.bin'))
    const refreshed: Credentials = { ...personalCreds, accessToken: 'NEW-TOKEN' }
    await run(contexts[0].saveCredentials(refreshed))
    expect(readFileSync(join(accDir(work.id), 'creds.bin'))).toEqual(bBefore)

    const fresh = await open()
    contexts = []
    await run(fresh.getProvider(personal.id))
    await run(fresh.getProvider(work.id))
    expect(contexts[0].credentials).toEqual(refreshed)
    expect(contexts[1].credentials).toEqual(workCreds)
  })

  it("remove wipes only A's dir and drops its provider", async () => {
    const { work, personal } = await addBoth()
    await run(store.getProvider(work.id))
    await run(store.writeCache(work.id, { calendars: [], events: [] }))
    await run(store.remove(work.id))
    expect(existsSync(accDir(work.id))).toBe(false)
    expect(existsSync(join(accDir(personal.id), 'creds.bin'))).toBe(true)
    expect((await run(store.list())).map((a) => a.id)).toEqual([personal.id])
    await expect(run(store.getProvider(work.id))).rejects.toThrow()
    // A stale provider refreshing tokens must not resurrect the wiped dir.
    await run(contexts[0].saveCredentials(workCreds))
    expect(existsSync(accDir(work.id))).toBe(false)
  })

  it('registry and account files never contain plaintext secrets', async () => {
    const { work, personal } = await addBoth()
    const registry = readFileSync(join(dir, 'accounts.json'), 'utf8')
    for (const secret of ['WORK-SECRET', 'PERSONAL-REFRESH-SECRET', 'password', 'refreshToken']) {
      expect(registry).not.toContain(secret)
    }
    for (const id of [work.id, personal.id]) {
      for (const f of readdirSync(accDir(id))) {
        const content = readFileSync(join(accDir(id), f), 'utf8')
        expect(content).not.toContain('WORK-SECRET')
        expect(content).not.toContain('PERSONAL-REFRESH-SECRET')
      }
    }
    expect(JSON.stringify(await run(store.list()))).not.toContain('SECRET')
  })

  it('keeps caches and hidden calendars separate per account', async () => {
    const { work, personal } = await addBoth()
    expect(await run(store.readCache(work.id))).toEqual({ calendars: [], events: [] })
    const cal = { id: 'c1', accountId: work.id, name: 'Work', color: '#f00', readOnly: false }
    await run(store.writeCache(work.id, { calendars: [cal], events: [], syncedAt: 'now' }))
    expect((await run(store.readCache(work.id))).calendars).toEqual([cal])
    expect(await run(store.readCache(personal.id))).toEqual({ calendars: [], events: [] })

    await run(store.setCalendarVisible(work.id, 'c1', false))
    expect(await run(store.hiddenCalendars(work.id))).toEqual(['c1'])
    expect(await run(store.hiddenCalendars(personal.id))).toEqual([])
    await run(store.setCalendarVisible(work.id, 'c1', true))
    expect(await run(store.hiddenCalendars(work.id))).toEqual([])
  })

  it('serves the cache from memory after a write', async () => {
    const { work } = await addBoth()
    await run(store.writeCache(work.id, { calendars: [], events: [], syncedAt: 'now' }))
    rmSync(join(dir, 'accounts', work.id, 'cache.json'))
    expect((await run(store.readCache(work.id))).syncedAt).toBe('now')
  })

  it('patchCache changes the cache in memory only', async () => {
    const { work } = await addBoth()
    await run(store.writeCache(work.id, { calendars: [], events: [], syncedAt: 'now' }))
    await run(store.patchCache(work.id, (c) => ({ ...c, syncedAt: 'patched' })))
    expect((await run(store.readCache(work.id))).syncedAt).toBe('patched')
    const fresh = await open()
    expect((await run(fresh.readCache(work.id))).syncedAt).toBe('now')
    await expect(run(store.patchCache('ghost', (c) => c))).rejects.toThrow()
  })

  it('rejects path-traversal ids before touching the filesystem', async () => {
    const { personal } = await addBoth()
    writeFileSync(join(dir, 'victim.txt'), 'x')
    for (const bad of ['../', '..', '../accounts', `../accounts/${personal.id}`, 'a/b', '', '/etc']) {
      await expect(run(store.remove(bad))).rejects.toThrow(/Invalid account id/)
      await expect(run(store.readCache(bad))).rejects.toThrow(/Invalid account id/)
      await expect(run(store.hiddenCalendars(bad))).rejects.toThrow(/Invalid account id/)
    }
    expect(existsSync(join(dir, 'victim.txt'))).toBe(true)
    expect(existsSync(accDir(personal.id))).toBe(true)
  })

  it('update with new credentials drops the memoized provider', async () => {
    const { work } = await addBoth()
    const p1 = await run(store.getProvider(work.id))
    const creds: Credentials = { ...workCreds, password: 'NEW' }
    await run(store.update(work.id, { label: 'Job', credentials: creds }))
    const p2 = await run(store.getProvider(work.id))
    expect(p2).not.toBe(p1)
    expect(contexts[1].credentials).toEqual(creds)
    expect((await run(store.get(work.id)))?.label).toBe('Job')
    expect(await run(store.getProvider(work.id))).toBe(p2)
  })

  it('refuses to store credentials when encryption is unavailable', async () => {
    const s = await open({ encrypt: () => Effect.fail(fail('Secure storage is unavailable')), decrypt: fakeCrypto.decrypt })
    await expect(run(s.add({ kind: 'caldav', label: 'W', email: 'w@x', color: '#000' }, workCreds))).rejects.toThrow()
    expect(await run(s.list())).toEqual([])
    expect(existsSync(join(dir, 'accounts.json'))).toBe(false)
  })

  it('serializes concurrent writes so remove always wins over in-flight writes', async () => {
    const { work, personal } = await addBoth()
    await run(store.getProvider(work.id))
    const pending = [
      run(contexts[0].saveCredentials(workCreds)),
      run(store.writeCache(work.id, { calendars: [], events: [] })).catch(() => {}),
      run(store.update(personal.id, { error: 'x' })),
      run(store.remove(work.id)),
      run(store.writeCache(work.id, { calendars: [], events: [] })).catch(() => {})
    ]
    await Promise.all(pending)
    expect(existsSync(accDir(work.id))).toBe(false)
    const onDisk = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8'))
    expect(onDisk).toEqual([{ ...personal, error: 'x' }])
  })

  it('persists the registry across restarts', async () => {
    await addBoth()
    const fresh = await open()
    expect(await run(fresh.list())).toEqual(await run(store.list()))
  })
})

describe('AccountStore corrupt files', () => {
  it('falls back to no hidden calendars on a corrupt prefs.json', async () => {
    const { work } = await addBoth()
    await run(store.setCalendarVisible(work.id, 'c1', false))
    writeFileSync(join(accDir(work.id), 'prefs.json'), '{"hidden": [')
    // A fresh store: prefs are read from disk once per account.
    const fresh = await open()
    expect(await run(fresh.hiddenCalendars(work.id))).toEqual([])
    await run(fresh.setCalendarVisible(work.id, 'c2', false))
    expect(await run(fresh.hiddenCalendars(work.id))).toEqual(['c2'])
  })

  it('refuses to start on a corrupt accounts.json and leaves it intact', async () => {
    await addBoth()
    const file = join(dir, 'accounts.json')
    writeFileSync(file, '[{"id":')
    await expect(open()).rejects.toThrow(`Could not read ${file}`)
    writeFileSync(file, '{}')
    await expect(open()).rejects.toThrow(/not a list of accounts/)
    expect(readFileSync(file, 'utf8')).toBe('{}')
  })
})
