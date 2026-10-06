import { test, expect, _electron as electron, type Page } from '@playwright/test'

/** Opens Settings → Events, runs `fn`, closes the sheet. */
async function inEventsSettings(page: Page, fn: () => Promise<void>): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-events').click()
  await fn()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-sheet')).toBeHidden()
}

test('long events: rails by default, all-day, cascade or blocks from Settings', async () => {
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
    await page.waitForTimeout(500) // the tab thumb settles
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

  // Cascade: every block nearly full width, each later one shifted right and on top; no threshold.
  await inEventsSettings(page, async () => {
    await page.getByTestId('long-mode-cascade').click()
    await expect(page.getByTestId('long-hours')).toHaveAttribute('aria-disabled', 'true')
  })
  const busy = blocks.filter({ hasText: 'busy' })
  await expect(busy).toHaveCount(2)
  await expect(page.getByTestId('busy-band')).toHaveCount(0)
  const [b1, b2] = [(await busy.nth(0).boundingBox())!, (await busy.nth(1).boundingBox())!]
  expect(Math.abs(b2.x - b1.x)).toBeGreaterThan(8)
  expect((await review.boundingBox())!.width).toBeGreaterThan(col.width * 0.8)
  await expect(review).toHaveClass(/is-cascade/)
  await page.screenshot({ path: 'e2e/screens/long-cascade.png' })

  // Expand to fill: ordinary blocks side by side; the threshold doesn't apply.
  await inEventsSettings(page, async () => {
    await page.getByTestId('long-mode-expand').click()
    await expect(page.getByTestId('long-hours')).toHaveAttribute('aria-disabled', 'true')
  })
  await expect(blocks.filter({ hasText: 'busy' })).toHaveCount(2)
  await expect(chips).toHaveCount(0)
  await expect(page.getByTestId('busy-band')).toHaveCount(0)
  await page.screenshot({ path: 'e2e/screens/long-expand.png' })

  // Rails again, with the threshold dragged to 12h: an 11h event is no longer long.
  await inEventsSettings(page, async () => {
    await page.getByTestId('long-mode-rails').click()
    const slider = page.getByTestId('long-hours')
    await expect(slider).toHaveAttribute('aria-valuenow', '6')
    const track = (await page.locator('.mrange-track').boundingBox())!
    const thumb = (await slider.boundingBox())!
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width * 0.3, thumb.y, { steps: 4 })
    await expect(slider).toHaveAttribute('aria-valuenow', '4.5')
    await page.mouse.move(track.x + track.width + 40, thumb.y, { steps: 4 })
    await page.mouse.up()
    await expect(slider).toHaveAttribute('aria-valuenow', '12')
    await expect(page.getByTestId('long-hours-value')).toHaveText('12 h')
    await page.screenshot({ path: 'e2e/screens/settings-events-slider.png' })
  })
  await expect(rails).toHaveCount(0)
  await expect(blocks.filter({ hasText: 'busy' })).toHaveCount(2)
  // Back to 6h from the keyboard: half-hour arrow steps, whole hours with Page keys.
  await inEventsSettings(page, async () => {
    const slider = page.getByTestId('long-hours')
    await slider.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(slider).toHaveAttribute('aria-valuenow', '11.5')
    await expect(page.getByTestId('long-hours-value')).toHaveText('11.5 h')
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('PageUp')
    await expect(slider).toHaveAttribute('aria-valuenow', '6')
  })
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
