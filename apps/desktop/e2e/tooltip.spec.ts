import { test, expect, _electron as electron } from '@playwright/test'

test('event tooltip shows the meeting link after a 1s hover', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  const blocks = page.getByTestId('event-block')
  const tip = page.getByTestId('event-tooltip')
  const standup = blocks.filter({ hasText: 'Daily standup' }).first()
  await expect(standup).toBeVisible()
  await standup.scrollIntoViewIfNeeded()

  // Short hover: nothing yet.
  await standup.hover()
  await page.waitForTimeout(500)
  await expect(tip).toHaveCount(0)

  // Continuous hover past 1s: only the link.
  await page.waitForTimeout(700)
  await expect(tip).toBeVisible()
  await expect(tip.locator('a')).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij')
  await expect(tip).toHaveText('https://meet.google.com/abc-defg-hij')

  // Moving onto the tooltip keeps it open.
  await tip.hover()
  await page.waitForTimeout(300)
  await expect(tip).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/tooltip.png' })

  // Escape hides it; an event without a URL never shows one.
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await blocks.filter({ hasText: 'Gym' }).hover()
  await page.waitForTimeout(1200)
  await expect(tip).toHaveCount(0)

  // Clicking a pill still opens details (and the tooltip stays gone).
  await standup.hover()
  await page.waitForTimeout(1200)
  await expect(tip).toBeVisible()
  await standup.click()
  await expect(tip).toHaveCount(0)

  await app.close()
})
