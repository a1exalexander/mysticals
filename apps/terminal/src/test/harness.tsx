/**
 * Test helpers for Ink screens: an in-process mock ClientApi (core createMockApi: accounts "work" + "personal"
 * with seeded events around today) whose methods are vi.fn spies, plus render/press/waitFor utilities.
 *
 *   const t = renderApp()                 // or renderWith(<EventDetails event={e} onClose={vi.fn()} onEdit={vi.fn()} />)
 *   await t.waitFor('Agenda')
 *   await t.press('w')                    // or t.press(KEY.down, KEY.enter)
 *   expect(t.lastFrame()).toContain('Week view')
 *   expect(t.client.events.respond).toHaveBeenCalledWith(expect.objectContaining({ id: 'work-11' }), 'accepted')
 */
import type { ReactElement } from 'react'
import { render } from 'ink-testing-library'
import { vi, type Mock } from 'vitest'
import { createMockApi } from '@multicals/core/mock/mockApi'
import type { ClientApi } from '../client'
import { ApiContext, type Nav } from '../ui/hooks'
import { App } from '../ui/App'

type Spied<T> = { [G in keyof T]: { [F in keyof T[G]]: T[G][F] extends (...a: infer A) => infer R ? Mock<(...a: A) => R> : never } }
export type TestClient = Spied<Omit<ClientApi, 'onChanged' | 'close'>> & {
  onChanged: ClientApi['onChanged']
  close: Mock<() => void>
  /** Fires a change push to every onChanged listener, as the daemon would. */
  emitChanged(accountId: string): void
}

export function createTestClient(): TestClient {
  const listeners = new Set<(accountId: string) => void>()
  const emitChanged = (id: string): void => listeners.forEach((l) => l(id))
  const impl = createMockApi(emitChanged) as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>
  const spied: Record<string, Record<string, Mock>> = {}
  for (const [group, fns] of Object.entries(impl)) {
    spied[group] = {}
    for (const [name, fn] of Object.entries(fns)) spied[group][name] = vi.fn(fn)
  }
  return Object.assign(spied as unknown as TestClient, {
    onChanged: (cb: (id: string) => void) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    close: vi.fn(),
    emitChanged
  })
}

/** Raw key sequences for `press`. */
export const KEY = {
  enter: '\r',
  esc: '\u001B',
  tab: '\t',
  shiftTab: '\u001B[Z',
  backspace: '\u007F',
  space: ' ',
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D'
} as const

export const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

export type Rendered = ReturnType<typeof render> & {
  client: TestClient
  /** Writes each key to stdin with a tick before each and after the last, so Ink re-renders in between. */
  press(...keys: string[]): Promise<void>
  /** Polls lastFrame() until it contains `text` (or the predicate passes); throws with the frame on timeout. */
  waitFor(match: string | ((frame: string) => boolean), timeoutMs?: number): Promise<string>
}

/** Renders any element inside ApiContext with a mock client. */
export function renderWith(node: ReactElement, client: TestClient = createTestClient()): Rendered {
  const r = render(<ApiContext.Provider value={client as unknown as ClientApi}>{node}</ApiContext.Provider>)
  return Object.assign(r, {
    client,
    async press(...keys: string[]) {
      for (const k of keys) {
        await tick() // let pending loads/effects land so the key hits the current handler
        r.stdin.write(k)
      }
      await tick()
    },
    async waitFor(match: string | ((frame: string) => boolean), timeoutMs = 2000) {
      const ok = typeof match === 'string' ? (f: string) => f.includes(match) : match
      const end = Date.now() + timeoutMs
      for (;;) {
        const frame = r.lastFrame() ?? ''
        if (ok(frame)) return frame
        if (Date.now() > end) throw new Error(`waitFor(${String(match)}) timed out; last frame:\n${frame}`)
        await tick(10)
      }
    }
  })
}

/** Renders the whole App shell (default nav: agenda at today). */
export function renderApp(opts: { client?: TestClient; nav?: Nav } = {}): Rendered {
  return renderWith(<App initialNav={opts.nav} />, opts.client)
}
