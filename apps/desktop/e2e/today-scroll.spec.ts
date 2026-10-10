import { test, expect, _electron as electron } from '@playwright/test'

test('today scrolls the time grid back to now; ‹ › keep the scroll', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 960, height: 600 })
  const grid = page.locator('.tg')
  const now = page.getByTestId('now-clock')
  // Away from now: to the end of the day before noon, else to its start.
  const away = (): Promise<number> =>
    grid.evaluate((el) => (el.scrollTop = new Date().getHours() < 12 ? el.scrollHeight : 0))

  await away()
  await expect(now).not.toBeInViewport()
  await page.keyboard.press('t')
  await expect(now).toBeInViewport()

  // The hours stay put (scroll anchoring may move scrollTop by what the all-day row grows or shrinks).
  const hours = (): Promise<number> => page.locator('.tg-body').evaluate((el) => Math.round(el.getBoundingClientRect().top))
  await grid.evaluate((el) => (el.scrollTop = 300))
  const before = await hours()
  await page.keyboard.press('l')
  await expect(now).toHaveCount(0)
  expect(await hours()).toBe(before)
  await away()
  await page.locator('.today-btn').click()
  await expect(now).toBeInViewport()
  await app.close()
})
