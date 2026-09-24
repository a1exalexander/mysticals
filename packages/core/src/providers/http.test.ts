import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { http, timedFetch } from './http'

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
afterEach(() => void (http.timeoutMs = 30_000))

it('gives up on a hung request', async () => {
  http.timeoutMs = 50
  await expect(timedFetch(url)).rejects.toThrow(/timed out/)
})

it("still honours the caller's own signal", async () => {
  const ctrl = new AbortController()
  const p = timedFetch(url, { signal: ctrl.signal })
  ctrl.abort()
  await expect(p).rejects.toThrow(/abort/i)
})
