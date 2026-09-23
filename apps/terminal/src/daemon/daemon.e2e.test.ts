/**
 * Real processes: builds dist/cli.js, opens two TUIs (piped stdin, mock mode) that must share one spawned daemon,
 * checks change pushes between clients, and that the daemon exits after the last client leaves.
 */
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { connect } from '../client'
import { socketPath } from '../paths'

const root = resolve(__dirname, '../..')
const cli = join(root, 'dist/cli.js')
const home = mkdtempSync(join(tmpdir(), 'mc-e2e-'))
const env = { ...process.env, MULTICALS_MOCK: '1', MULTICALS_HOME: home }
const procs: ChildProcess[] = []

beforeAll(() => {
  execFileSync(join(root, 'node_modules/.bin/tsup'), { cwd: root, stdio: 'ignore' })
}, 60_000)
afterAll(() => {
  for (const p of procs) p.kill()
  rmSync(home, { recursive: true, force: true })
})

function tui(): { proc: ChildProcess; out: () => string } {
  const proc = spawn(process.execPath, [cli], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  procs.push(proc)
  let out = ''
  proc.stdout!.on('data', (b) => (out += b))
  proc.stderr!.on('data', (b) => (out += b))
  return { proc, out: () => out }
}

/** Daemons (cli.js --daemon) whose parent is one of `parents`. */
function daemonsOf(parents: number[]): number[] {
  return execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter(([, ppid, ...args]) => parents.includes(Number(ppid)) && args.join(' ').includes('cli.js --daemon'))
    .map(([pid]) => Number(pid))
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

it('two TUIs share one daemon, see each other’s changes, and the daemon stops after both close', async () => {
  const a = tui()
  const b = tui()
  await vi.waitFor(() => expect(a.out()).toContain('Holiday'), { timeout: 10_000, interval: 50 })
  await vi.waitFor(() => expect(b.out()).toContain('Holiday'), { timeout: 10_000, interval: 50 })

  const daemons = daemonsOf([a.proc.pid!, b.proc.pid!])
  expect(daemons).toHaveLength(1)
  const [daemon] = daemons

  // Two more clients on the same socket: a change from one reaches the other.
  const noSpawn = (): void => {
    throw new Error('daemon should already be running')
  }
  const c1 = await connect(socketPath(home), noSpawn)
  const c2 = await connect(socketPath(home), noSpawn)
  const seen = vi.fn()
  c2.onChanged(seen)
  await c1.accounts.update('work', { label: 'Job' })
  await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('work'))
  expect((await c2.accounts.list()).find((x) => x.id === 'work')?.label).toBe('Job')
  c1.close()
  c2.close()

  // Closing stdin ends a piped TUI.
  const exited = (p: ChildProcess): Promise<unknown> => new Promise((r) => (p.exitCode !== null ? r(0) : p.once('exit', r)))
  a.proc.stdin!.end()
  b.proc.stdin!.end()
  await Promise.all([exited(a.proc), exited(b.proc)])

  expect(alive(daemon)).toBe(true) // 3 s grace
  await vi.waitFor(() => expect(alive(daemon)).toBe(false), { timeout: 10_000, interval: 100 })
  expect(existsSync(socketPath(home))).toBe(false)
}, 30_000)
