import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Account, Calendar } from '@shared/types'

const account: Account = { id: 'a', kind: 'caldav', label: 'A', email: 'a@x', color: '#fff' }
const cal = (visible: boolean): Calendar => ({ id: 'c', accountId: 'a', name: 'C', color: '#fff', readOnly: false, visible })

// A fake window.api that tracks onChanged listeners; each test gets a fresh store module.
async function setup() {
  const listeners = new Set<(id: string) => void>()
  const api = {
    accounts: { list: vi.fn(async () => [account]) },
    calendars: {
      list: vi.fn(async () => [cal(true)]),
      setVisible: vi.fn(async (_a: string, _c: string, _v: boolean): Promise<void> => {})
    },
    onChanged: vi.fn((cb: (id: string) => void) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    })
  }
  vi.stubGlobal('window', { api })
  vi.resetModules()
  const mod = await import('./useCalendarData')
  return { api, listeners, mod, change: () => listeners.forEach((f) => f('a')) }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r))

describe('directory store', () => {
  // Cold first import (react) can exceed the 5s test timeout on CI runners; pay it once here.
  beforeAll(() => import('./useCalendarData'), 30_000)
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shares one onChanged listener and one reload per change across subscribers', async () => {
    const { api, listeners, mod, change } = await setup()
    const a = vi.fn()
    const b = vi.fn()
    const offA = mod.directory.subscribe(a)
    const offB = mod.directory.subscribe(b)
    await flush()
    expect(api.onChanged).toHaveBeenCalledTimes(1)
    expect(api.accounts.list).toHaveBeenCalledTimes(1)
    expect(mod.directory.get()).toEqual({ accounts: [account], calendars: [cal(true)], loaded: true })
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()

    change()
    await flush()
    expect(api.accounts.list).toHaveBeenCalledTimes(2)
    expect(api.calendars.list).toHaveBeenCalledTimes(2)

    offA()
    expect(listeners.size).toBe(1)
    offB()
    expect(listeners.size).toBe(0)
    mod.directory.subscribe(a)
    expect(api.onChanged).toHaveBeenCalledTimes(2)
    expect(listeners.size).toBe(1)
  })

  it('drops a reload that answers after a newer one', async () => {
    const { api, mod, change } = await setup()
    let answer!: (cs: Calendar[]) => void
    api.calendars.list.mockImplementationOnce(() => new Promise((r) => (answer = r)))
    mod.directory.subscribe(() => {})
    change()
    await flush()
    expect(mod.directory.get().calendars).toEqual([cal(true)])
    answer([cal(false)])
    await flush()
    expect(mod.directory.get().calendars).toEqual([cal(true)])
  })

  it('shows a visibility toggle at once, keeps it over reloads while saving, and reverts on failure', async () => {
    const { api, mod, change } = await setup()
    mod.directory.subscribe(() => {})
    await flush()
    let fail!: (e: Error) => void
    api.calendars.setVisible.mockImplementationOnce(() => new Promise((_, rej) => (fail = rej)))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mod.setCalendarVisible('a', 'c', false)
    expect(mod.directory.get().calendars[0].visible).toBe(false)
    expect(api.calendars.setVisible).toHaveBeenCalledWith('a', 'c', false)

    // The server hasn't stored it yet: a reload must not flip the checkbox back.
    change()
    await flush()
    expect(mod.directory.get().calendars[0].visible).toBe(false)

    fail(new Error('offline'))
    await flush()
    expect(mod.directory.get().calendars[0].visible).toBe(true)
  })
})
