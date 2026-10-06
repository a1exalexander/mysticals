import { test, expect, _electron as electron } from '@playwright/test'

test('sidebar collapses and expands, remembers it, and ⌘\\ / Ctrl+\\ toggles it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  const sidebar = page.getByTestId('sidebar')
  const toggle = page.getByTestId('sidebar-toggle')
  const title = page.locator('.toolbar-title')

  // Expanded by default: the one toggle sits in the toolbar, just left of the title and level with it.
  await expect(sidebar).toBeVisible()
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const tb = (await toggle.boundingBox())!
  const hb = (await title.boundingBox())!
  expect(tb.x + tb.width).toBeLessThanOrEqual(hb.x)
  expect(hb.x - (tb.x + tb.width)).toBeLessThan(20)
  expect(Math.abs(tb.y + tb.height / 2 - (hb.y + hb.height / 2))).toBeLessThan(4)

  await toggle.click()
  await expect(sidebar).toBeHidden()
  // The same toggle stays in place beside the title to bring it back.
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeLessThan(1)
  expect((await toggle.boundingBox())!.x + tb.width).toBeLessThanOrEqual((await title.boundingBox())!.x)
  await page.screenshot({ path: 'e2e/screens/sidebar-collapsed.png' })

  // Survives a reload.
  await page.reload()
  await expect(page.locator('.app-loader')).toBeHidden()
  await expect(sidebar).toBeHidden()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backslash' : 'Control+Backslash')
  await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeGreaterThan(200)

  // One toggle both hides and shows it.
  await toggle.click()
  await expect(sidebar).toBeHidden()
  await toggle.click()
  await expect(sidebar).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await app.close()
})
