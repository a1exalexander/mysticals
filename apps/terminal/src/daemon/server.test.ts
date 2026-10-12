import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect, Exit, Scope } from 'effect'
import { createMockApi } from '@mysticals/core/mock/mockApi'
import { connect, type ClientApi } from '../client'
import { socketPath } from '../paths'
import { AddressInUse, serve, type Daemon } from './server'

let dir: string
let path: string
const open: { close(): unknown }[] = []
const track = <T extends { close(): unknown }>(x: T): T => (open.push(x), x)
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const run = Effect.runPromise
// Windows sockets are named pipes, not files: no mode bits and nothing stale left on disk.
const posixIt = it.skipIf(process.platform === 'win32')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-srv-'))
  path = socketPath(dir) // a named pipe on Windows
})
afterEach(async () => {
  for (const x of open.splice(0)) await x.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A daemon on `path`; `close()` closes its scope (what ends the server). */
async function start(onIdle = vi.fn(), graceMs = 50): Promise<Daemon & { close(): Promise<void> }> {
  const scope = await run(Scope.make())
  const close = (): Promise<void> => run(Scope.close(scope, Exit.void))
  let d: Daemon | undefined
  const api = createMockApi((id) => d?.broadcast(id))
  d = await run(Scope.provide(serve(api, path, { onIdle, graceMs }), scope)).catch(async (e: unknown) => {
    await close()
    throw e
  })
  return track({ ...d, close })
}

const dial = (spawn: () => void = () => {}): Promise<ClientApi> => run(connect(path, spawn))

describe('daemon server', () => {
  it('serves api calls, errors and change pushes to every client', async () => {
    await start()
    const a: ClientApi = track(await dial())
    const b: ClientApi = track(await dial())
    expect((await run(a.accounts.list())).map((x) => x.id)).toEqual(['work', 'personal'])
    await expect(run(a.accounts.addGoogle())).rejects.toThrow('Not available in mock mode')

    const seen = vi.fn()
    b.onChanged(seen)
    await run(a.accounts.update('work', { label: 'Job' }))
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('work'))
    expect((await run(b.accounts.list()))[0].label).toBe('Job')
  })

  posixIt('socket is private to the user', async () => {
    await start()
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('goes idle only after the last client leaves', async () => {
    const onIdle = vi.fn()
    const d = await start(onIdle)
    const a = await dial()
    const b = await dial()
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

  posixIt('reclaims a stale socket file but refuses a live one', async () => {
    writeFileSync(path, '')
    await start()
    const refused = start()
    await expect(refused).rejects.toBeInstanceOf(AddressInUse)
    await expect(refused).rejects.toMatchObject({ code: 'EADDRINUSE' })
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
    const c = track(await dial(spawn))
    const seen = vi.fn()
    c.onChanged(seen)
    await d1.close()
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(''))
    expect(await run(c.accounts.list())).toHaveLength(2)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('starts a daemon when none answers, then connects', async () => {
    const spawn = vi.fn(() => void start())
    const c = track(await dial(spawn))
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(await run(c.calendars.list())).toHaveLength(3)
  })
})
