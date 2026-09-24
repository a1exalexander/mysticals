import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import electronPath from 'electron'
import { test, expect, _electron as electron } from '@playwright/test'

// Real (non-mock) backend on a throwaway profile; no accounts, so nothing touches the network.
const profile = (): string => mkdtempSync(join(tmpdir(), 'mysticals-e2e-'))
const env = { ...process.env, MYSTICALS_MOCK: '' }
const bin = electronPath as unknown as string

test('a second copy on the same profile exits and leaves accounts.json alone', async () => {
  const dir = profile()
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], env })
  await app.firstWindow()
  writeFileSync(join(dir, 'accounts.json'), '[]')
  const second = spawn(bin, ['.', `--user-data-dir=${dir}`], { env, stdio: 'ignore' })
  const code = await new Promise<number | null>((resolve) => second.on('exit', resolve))
  expect(code).toBe(0)
  expect(app.windows()).toHaveLength(1)
  expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).toBe('[]')
  await app.close()
})

test('a corrupt accounts.json is reported, not silently swallowed', async () => {
  const dir = profile()
  writeFileSync(join(dir, 'accounts.json'), '{not json')
  // showErrorBox is modal and blocks, so watch stderr for the report, then kill.
  const child = spawn(bin, ['.', `--user-data-dir=${dir}`], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  try {
    await expect.poll(() => err, { timeout: 15_000 }).toContain('failed to load accounts')
  } finally {
    child.kill()
  }
  expect(err).toContain(join(dir, 'accounts.json'))
  expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).toBe('{not json')
})
