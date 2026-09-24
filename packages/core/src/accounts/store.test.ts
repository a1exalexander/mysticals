import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credentials } from '../shared/types'
import type { ProviderContext, ProviderFactory } from '../providers/types'
import { MockProvider } from '../mock/MockProvider'
import { AccountStore, type SecretCrypto } from './store'

// Reversible fake "encryption" so tests can assert plaintext never hits disk.
const fakeCrypto: SecretCrypto = {
  encrypt: (s) => Buffer.from(Buffer.from(s).toString('base64').split('').reverse().join('')),
  decrypt: (b) => Buffer.from(b.toString().split('').reverse().join(''), 'base64').toString()
}

const workCreds: Credentials = { kind: 'caldav', serverUrl: 'https://mail.work.example', username: 'me@work.example', password: 'WORK-SECRET' }
const personalCreds: Credentials = { kind: 'google', refreshToken: 'PERSONAL-REFRESH-SECRET' }

let dir: string
let contexts: ProviderContext[]
let store: AccountStore

function factory(): ProviderFactory {
  return (ctx) => {
    contexts.push(ctx)
    return new MockProvider(ctx.accountId, ctx.email, [])
  }
}

async function addBoth() {
  const work = await store.add({ kind: 'caldav', label: 'Work', email: 'me@work.example', color: '#f00' }, workCreds)
  const personal = await store.add({ kind: 'google', label: 'Personal', email: 'me@gmail.com', color: '#0f0' }, personalCreds)
  return { work, personal }
}

const accDir = (id: string) => join(dir, 'accounts', id)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mysticals-store-'))
  contexts = []
  store = new AccountStore(dir, { caldav: factory(), google: factory() }, fakeCrypto)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('AccountStore isolation', () => {
  it('gives each provider only its own id, email and credentials', async () => {
    const { work, personal } = await addBoth()
    store.getProvider(work.id)
    store.getProvider(personal.id)
    expect(contexts).toHaveLength(2)
    expect(Object.keys(contexts[0]).sort()).toEqual(['accountId', 'credentials', 'email', 'saveCredentials'])
    expect(contexts[0]).toMatchObject({ accountId: work.id, email: 'me@work.example', credentials: workCreds })
    expect(contexts[1]).toMatchObject({ accountId: personal.id, email: 'me@gmail.com', credentials: personalCreds })
  })

  it('memoizes one provider per account', async () => {
    const { work } = await addBoth()
    expect(store.getProvider(work.id)).toBe(store.getProvider(work.id))
    expect(contexts).toHaveLength(1)
  })

  it("saveCredentials from A only touches A's creds", async () => {
    const { work, personal } = await addBoth()
    store.getProvider(personal.id)
    store.getProvider(work.id)
    const bBefore = readFileSync(join(accDir(work.id), 'creds.bin'))
    const refreshed: Credentials = { ...personalCreds, accessToken: 'NEW-TOKEN' }
    await contexts[0].saveCredentials(refreshed)
    expect(readFileSync(join(accDir(work.id), 'creds.bin'))).toEqual(bBefore)

    const fresh = new AccountStore(dir, { caldav: factory(), google: factory() }, fakeCrypto)
    contexts = []
    fresh.getProvider(personal.id)
    fresh.getProvider(work.id)
    expect(contexts[0].credentials).toEqual(refreshed)
    expect(contexts[1].credentials).toEqual(workCreds)
  })

  it("remove wipes only A's dir and drops its provider", async () => {
    const { work, personal } = await addBoth()
    store.getProvider(work.id)
    await store.writeCache(work.id, { calendars: [], events: [] })
    await store.remove(work.id)
    expect(existsSync(accDir(work.id))).toBe(false)
    expect(existsSync(join(accDir(personal.id), 'creds.bin'))).toBe(true)
    expect(store.list().map((a) => a.id)).toEqual([personal.id])
    expect(() => store.getProvider(work.id)).toThrow()
    // A stale provider refreshing tokens must not resurrect the wiped dir.
    await contexts[0].saveCredentials(workCreds)
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
    expect(JSON.stringify(store.list())).not.toContain('SECRET')
  })

  it('keeps caches and hidden calendars separate per account', async () => {
    const { work, personal } = await addBoth()
    expect(store.readCache(work.id)).toEqual({ calendars: [], events: [] })
    const cal = { id: 'c1', accountId: work.id, name: 'Work', color: '#f00', readOnly: false }
    await store.writeCache(work.id, { calendars: [cal], events: [], syncedAt: 'now' })
    expect(store.readCache(work.id).calendars).toEqual([cal])
    expect(store.readCache(personal.id)).toEqual({ calendars: [], events: [] })

    await store.setCalendarVisible(work.id, 'c1', false)
    expect(store.hiddenCalendars(work.id)).toEqual(['c1'])
    expect(store.hiddenCalendars(personal.id)).toEqual([])
    await store.setCalendarVisible(work.id, 'c1', true)
    expect(store.hiddenCalendars(work.id)).toEqual([])
  })

  it('rejects path-traversal ids before touching the filesystem', async () => {
    const { personal } = await addBoth()
    writeFileSync(join(dir, 'victim.txt'), 'x')
    for (const bad of ['../', '..', '../accounts', `../accounts/${personal.id}`, 'a/b', '', '/etc']) {
      await expect(store.remove(bad)).rejects.toThrow(/Invalid account id/)
      expect(() => store.readCache(bad)).toThrow(/Invalid account id/)
      expect(() => store.hiddenCalendars(bad)).toThrow(/Invalid account id/)
    }
    expect(existsSync(join(dir, 'victim.txt'))).toBe(true)
    expect(existsSync(accDir(personal.id))).toBe(true)
  })

  it('update with new credentials drops the memoized provider', async () => {
    const { work } = await addBoth()
    const p1 = store.getProvider(work.id)
    const creds: Credentials = { ...workCreds, password: 'NEW' }
    await store.update(work.id, { label: 'Job', credentials: creds })
    const p2 = store.getProvider(work.id)
    expect(p2).not.toBe(p1)
    expect(contexts[1].credentials).toEqual(creds)
    expect(store.get(work.id)?.label).toBe('Job')
    expect(store.getProvider(work.id)).toBe(p2)
  })

  it('refuses to store credentials when encryption is unavailable', async () => {
    const encrypt = vi.fn(() => {
      throw new Error('Secure storage is unavailable')
    })
    const s = new AccountStore(dir, { caldav: factory(), google: factory() }, { encrypt, decrypt: fakeCrypto.decrypt })
    await expect(s.add({ kind: 'caldav', label: 'W', email: 'w@x', color: '#000' }, workCreds)).rejects.toThrow()
    expect(s.list()).toEqual([])
    expect(existsSync(join(dir, 'accounts.json'))).toBe(false)
  })

  it('serializes concurrent writes so remove always wins over in-flight writes', async () => {
    const { work, personal } = await addBoth()
    store.getProvider(work.id)
    const pending = [
      contexts[0].saveCredentials(workCreds),
      store.writeCache(work.id, { calendars: [], events: [] }).catch(() => {}),
      store.update(personal.id, { error: 'x' }),
      store.remove(work.id),
      store.writeCache(work.id, { calendars: [], events: [] }).catch(() => {})
    ]
    await Promise.all(pending)
    expect(existsSync(accDir(work.id))).toBe(false)
    const onDisk = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8'))
    expect(onDisk).toEqual([{ ...personal, error: 'x' }])
  })

  it('persists the registry across restarts', async () => {
    await addBoth()
    const fresh = new AccountStore(dir, { caldav: factory(), google: factory() }, fakeCrypto)
    expect(fresh.list()).toEqual(store.list())
  })
})
