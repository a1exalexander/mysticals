import { test, expect, _electron as electron } from '@playwright/test'

test('app launches in mock mode', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  const logs: string[] = []
  page.on('console', (m) => logs.push(m.text()))
  // Listen from the first line on: the listener leak warned while the window mounted.
  await page.reload()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  const accounts = await page.evaluate(() => window.api.accounts.list())
  expect(accounts.map((a) => a.id).sort()).toEqual(['personal', 'work'])
  await page.screenshot({ path: 'e2e/screens/smoke.png' })
  expect(logs.filter((l) => l.includes('MaxListenersExceededWarning'))).toEqual([])
  await app.close()
})
