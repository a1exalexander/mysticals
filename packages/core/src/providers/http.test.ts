import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { Effect } from 'effect'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { HttpTimeout, request } from './http'

// Accepts connections and never answers.
let server: Server
let url: string
beforeAll(async () => {
  server = createServer(() => {})
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

it('gives up on a hung request', async () => {
  await expect(Effect.runPromise(request(url).pipe(Effect.provideService(HttpTimeout, 50)))).rejects.toThrow(/timed out/)
})

it("still honours the caller's own signal", async () => {
  const ctrl = new AbortController()
  const p = Effect.runPromise(request(url, { signal: ctrl.signal }))
  ctrl.abort()
  await expect(p).rejects.toThrow(/abort/i)
})
