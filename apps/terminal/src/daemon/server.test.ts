import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockApi } from '@mysticals/core/mock/mockApi'
import { connect, type ClientApi } from '../client'
import { serve, type Daemon } from './server'

let dir: string
let path: string
const open: { close(): unknown }[] = []
const track = <T extends { close(): unknown }>(x: T): T => (open.push(x), x)
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-srv-'))
  path = join(dir, 's.sock')
})
afterEach(async () => {
  for (const x of open.splice(0)) await x.close()
  rmSync(dir, { recursive: true, force: true })
})

async function start(onIdle = vi.fn(), graceMs = 50): Promise<Daemon> {
  let d: Daemon | undefined
  const api = createMockApi((id) => d?.broadcast(id))
  d = track(await serve(api, path, { onIdle, graceMs }))
  return d
}

describe('daemon server', () => {
  it('serves api calls, errors and change pushes to every client', async () => {
    await start()
    const a: ClientApi = track(await connect(path, () => {}))
    const b: ClientApi = track(await connect(path, () => {}))
    expect((await a.accounts.list()).map((x) => x.id)).toEqual(['work', 'personal'])
    await expect(a.accounts.addGoogle()).rejects.toThrow('Not available in mock mode')

    const seen = vi.fn()
    b.onChanged(seen)
    await a.accounts.update('work', { label: 'Job' })
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('work'))
    expect((await b.accounts.list())[0].label).toBe('Job')
  })

  it('socket is private to the user', async () => {
    await start()
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('goes idle only after the last client leaves', async () => {
    const onIdle = vi.fn()
    const d = await start(onIdle)
    const a = await connect(path, () => {})
    const b = await connect(path, () => {})
    await wait(100)
    expect(d.clientCount()).toBe(2)
    a.close()
    await wait(100)
    expect(onIdle).not.toHaveBeenCalled()
    b.close()
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1))
  })

  it('goes idle when nobody ever connects', async () => {
    const onIdle = vi.fn()
    await start(onIdle)
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalled())
  })

  it('reclaims a stale socket file but refuses a live one', async () => {
    writeFileSync(path, '')
    await start()
    await expect(start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })

  it('rejects unknown methods', async () => {
    await start()
    const { createConnection } = await import('net')
    const sock = createConnection(path).setEncoding('utf8')
    const raw = await new Promise<string>((resolve) => {
      sock.once('data', (b) => resolve(String(b)))
      sock.write(JSON.stringify({ id: 99, method: 'constructor', params: [] }) + '\n')
    })
    sock.destroy()
    expect(JSON.parse(raw)).toEqual({ id: 99, error: 'Unknown method: constructor' })
  })
})

describe('connect', () => {
  it('reconnects after the daemon goes away and tells listeners to reload', async () => {
    const d1 = await start()
    const spawn = vi.fn(() => void start())
    const c = track(await connect(path, spawn))
    const seen = vi.fn()
    c.onChanged(seen)
    await d1.close()
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(''))
    expect(await c.accounts.list()).toHaveLength(2)
    expect(spawn).toHaveBeenCalledTimes(1)
  })


  it('starts a daemon when none answers, then connects', async () => {
    const spawn = vi.fn(() => void start())
    const c = track(await connect(path, spawn))
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(await c.calendars.list()).toHaveLength(3)
  })
})
