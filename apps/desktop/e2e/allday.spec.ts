import { test, expect, _electron as electron } from '@playwright/test'

test('all-day row collapses past three events per day and expands on demand', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  // The next 3-day page starts at today + 3, where the mock seeds four all-day events.
  await page.getByTestId('view-switch-3day').click()
  await page.keyboard.press('l')
  const cells = page.locator('.tg-allday-cell')
  await expect(cells).toHaveCount(3)
  const most = (): Promise<number> =>
    cells.evaluateAll((els) => Math.max(...els.map((el) => el.querySelectorAll('[data-testid="event-block"]').length)))
  const birthday = page.getByTestId('event-block').filter({ hasText: 'Birthday' })

  const expand = page.getByRole('button', { name: 'Show 1 more all-day event' })
  await expect(expand).toBeVisible()
  expect(await most()).toBe(3)
  await expect(birthday).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Collapse all-day events' })).toHaveCount(0)
  await page.screenshot({ path: 'e2e/screens/allday-collapsed.png' })

  await expand.click()
  await expect(birthday).toBeVisible()
  expect(await most()).toBe(4)
  await expect(page.getByTestId('editor')).toHaveCount(0) // the toggle doesn't create an event
  await page.screenshot({ path: 'e2e/screens/allday-expanded.png' })

  await page.getByRole('button', { name: 'Collapse all-day events' }).click()
  await expect(birthday).toHaveCount(0)
  expect(await most()).toBe(3)
  await app.close()
})
