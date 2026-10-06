import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { choose } from './choose'

/** Opens Settings → Events, runs `fn`, closes the sheet. */
async function inEventsSettings(page: Page, fn: () => Promise<void>): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-events').click()
  await fn()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-sheet')).toBeHidden()
}

test('long events: rails by default, all-day or blocks from Settings', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  const blocks = page.getByTestId('event-block')
  const rails = page.getByTestId('event-rail')
  const review = blocks.filter({ hasText: 'Design review' })

  // Two days ago: two teammates busy 09:00–20:00 and a meeting in between.
  await page.getByTestId('view-switch-day').click()
  await page.keyboard.press('h')
  await page.keyboard.press('h')
  await expect(review).toHaveCount(1)

  // Default: rails (longer than 6h). The meeting gets nearly the whole column.
  await expect(rails).toHaveCount(2)
  await expect(blocks.filter({ hasText: 'busy' })).toHaveCount(0)
  await expect(page.getByTestId('busy-band')).toHaveCount(1)
  const col = (await page.locator('.tg-col').boundingBox())!
  expect((await review.boundingBox())!.width).toBeGreaterThan(col.width * 0.8)
  await review.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'e2e/screens/long-rails.png' })
  // A rail opens its details like any block.
  await rails.first().click()
  await expect(page.getByTestId('details')).toContainText('busy')
  await page.keyboard.press('Escape')

  // Move to all-day: chips with their hours in the all-day row; the busy hatch stays.
  await inEventsSettings(page, async () => {
    await expect(page.getByTestId('long-mode-rails')).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'e2e/screens/settings-events.png' })
    await page.getByTestId('long-mode-allday').click()
    await expect(page.getByTestId('long-mode-allday')).toHaveAttribute('aria-checked', 'true')
  })
  await expect(rails).toHaveCount(0)
  const chips = page.locator('.ev-allday.is-promoted')
  await expect(chips).toHaveCount(2)
  await expect(chips.first()).toContainText('9–20')
  await expect(page.getByTestId('busy-band')).toHaveCount(1)
  expect((await review.boundingBox())!.width).toBeGreaterThan(col.width * 0.9)
  await page.screenshot({ path: 'e2e/screens/long-allday.png' })

  // Expand to fill: ordinary blocks side by side; the threshold doesn't apply.
  await inEventsSettings(page, async () => {
    await page.getByTestId('long-mode-expand').click()
    await expect(page.getByTestId('long-hours')).toBeDisabled()
  })
  await expect(blocks.filter({ hasText: 'busy' })).toHaveCount(2)
  await expect(chips).toHaveCount(0)
  await expect(page.getByTestId('busy-band')).toHaveCount(0)
  await page.screenshot({ path: 'e2e/screens/long-expand.png' })

  // Rails again, with a 12h threshold: an 11h event is no longer long.
  await inEventsSettings(page, async () => {
    await page.getByTestId('long-mode-rails').click()
    await choose(page.getByTestId('long-hours'), '12')
  })
  await expect(rails).toHaveCount(0)
  await expect(blocks.filter({ hasText: 'busy' })).toHaveCount(2)
  await inEventsSettings(page, async () => choose(page.getByTestId('long-hours'), '6'))
  await expect(rails).toHaveCount(2)

  // The choice survives a reload.
  await inEventsSettings(page, async () => page.getByTestId('long-mode-allday').click())
  await page.reload()
  await page.getByTestId('view-switch-day').click()
  await page.keyboard.press('h')
  await page.keyboard.press('h')
  await expect(chips).toHaveCount(2)
  await app.close()
})
