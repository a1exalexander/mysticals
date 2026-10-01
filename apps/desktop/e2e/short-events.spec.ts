import { test, expect, _electron as electron } from '@playwright/test'

test('short events show their title, not the meeting link', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  const block = page.getByTestId('event-block').filter({ hasText: 'Quarterly roadmap sync' })
  await expect(block).toHaveClass(/is-short/)
  const title = block.locator('.ev-title')
  await expect(title).toBeVisible()
  // The title gets the row; time and place only take what is left.
  const titleBox = (await title.boundingBox())!
  const blockBox = (await block.boundingBox())!
  expect(titleBox.width).toBeGreaterThan(blockBox.width / 2)
  await expect(block).not.toContainText('zoom')
  await expect(block).not.toContainText('Zoom')
  await page.screenshot({ path: 'e2e/screens/short-events.png' })
  await app.close()
})
