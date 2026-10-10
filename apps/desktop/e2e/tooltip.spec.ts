import { test, expect, _electron as electron } from '@playwright/test'

test('event tooltip shows title, time and meeting link after a 1s hover', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  const blocks = page.getByTestId('event-block')
  const tip = page.getByTestId('event-tooltip')
  const standup = blocks.filter({ hasText: 'Daily standup' }).first()
  await expect(standup).toBeVisible()
  await standup.scrollIntoViewIfNeeded()
  // The custom tooltip is the only one: no native title on any pill.
  await expect(page.locator('[data-testid="event-block"][title], [data-testid="event-rail"][title]')).toHaveCount(0)

  // Short hover: nothing yet.
  await standup.hover()
  await page.waitForTimeout(500)
  await expect(tip).toHaveCount(0)

  // Continuous hover past 1s: title, time and the link.
  await page.waitForTimeout(700)
  await expect(tip).toBeVisible()
  await expect(tip.locator('.ett-title')).toHaveText('Daily standup')
  await expect(tip.locator('.ett-when')).toHaveText(/ · 10:00 – 10:15$/)
  await expect(tip.locator('a')).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij')
  await expect(tip.locator('a')).toHaveText('https://meet.google.com/abc-defg-hij')

  // Moving onto the tooltip keeps it open.
  await tip.hover()
  await page.waitForTimeout(300)
  await expect(tip).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/tooltip.png' })

  // Escape hides it; an event without a URL shows the same tooltip without a link.
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await blocks.filter({ hasText: 'Gym' }).hover()
  await page.waitForTimeout(1200)
  await expect(tip.locator('.ett-title')).toHaveText('Gym')
  await expect(tip.locator('.ett-when')).toHaveText(/ · 19:00 – 20:00$/)
  await expect(tip.locator('a')).toHaveCount(0)

  // An all-day chip too.
  await page.keyboard.press('Escape')
  await blocks.filter({ hasText: 'Holiday' }).hover()
  await page.waitForTimeout(1200)
  await expect(tip.locator('.ett-title')).toHaveText('Holiday')
  await expect(tip.locator('.ett-when')).toHaveText(/ · all day$/)

  // Keyboard focus shows it as well. Focus moving on to another pill drops the old one at once, well before the next
  // pill's own 1s. Without a scroll (which hides it anyway): both pills are a 07:00 Morning run, today's and a
  // neighbouring day's.
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  const stops = page.locator('.tg-col > [tabindex="0"]')
  const i = await stops.evaluateAll((els) => els.findIndex((el) => el.parentElement?.classList.contains('is-today')))
  const left = i > 0
  await stops.nth(i).focus()
  await page.keyboard.press(left ? 'ArrowLeft' : 'ArrowRight')
  await page.waitForTimeout(1200)
  await expect(tip.locator('.ett-title')).toHaveText('Morning run')
  const grid = page.locator('.tg')
  const scrolled = await grid.evaluate((el) => el.scrollTop)
  await page.keyboard.press(left ? 'ArrowRight' : 'ArrowLeft')
  await expect(stops.nth(i)).toBeFocused()
  await expect(tip).toHaveCount(0, { timeout: 500 })
  expect(await grid.evaluate((el) => el.scrollTop)).toBe(scrolled)
  await page.waitForTimeout(1200)
  await expect(tip.locator('.ett-title')).toHaveText('Morning run')
  await page.keyboard.press('Tab')
  await expect(tip).toHaveCount(0)

  // Clicking a pill still opens details (and the tooltip stays gone).
  await standup.hover()
  await page.waitForTimeout(1200)
  await expect(tip.locator('.ett-title')).toHaveText('Daily standup')
  await standup.click()
  await expect(tip).toHaveCount(0)

  await app.close()
})
