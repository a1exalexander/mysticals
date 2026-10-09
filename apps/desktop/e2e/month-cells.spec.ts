import { test, expect, _electron as electron } from '@playwright/test'

test('month: a cell lists as many events as it fits', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 940 })
  await page.getByTestId('view-switch-month').click()
  // Today (mock data): the holiday, morning run, standup, roadmap sync and gym.
  const today = page.locator('.mg-cell.is-today')
  const listed = today.getByTestId('event-block')
  const more = today.locator('.mg-more')
  await expect(listed).toHaveCount(5)
  await expect(more).toHaveCount(0)

  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(listed).toHaveCount(3)
  await expect(more).toHaveText('+2 more')

  // The smallest window: one event above "+N more".
  await page.setViewportSize({ width: 960, height: 600 })
  await expect(listed).toHaveCount(1)
  await expect(more).toHaveText('+4 more')
  await page.screenshot({ path: 'e2e/screens/month-narrow.png' })
  await app.close()
})
