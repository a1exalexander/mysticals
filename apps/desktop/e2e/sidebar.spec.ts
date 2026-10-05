import { test, expect, _electron as electron } from '@playwright/test'

test('sidebar collapses and expands, remembers it, and ⌘\\ / Ctrl+\\ toggles it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  const sidebar = page.getByTestId('sidebar')
  const toggle = page.getByTestId('sidebar-toggle')

  // Expanded by default.
  await expect(sidebar).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  await toggle.click()
  await expect(sidebar).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeLessThan(1)
  await page.screenshot({ path: 'e2e/screens/sidebar-collapsed.png' })

  // Survives a reload.
  await page.reload()
  await expect(page.locator('.app-loader')).toBeHidden()
  await expect(sidebar).toBeHidden()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backslash' : 'Control+Backslash')
  await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeGreaterThan(200)
  await app.close()
})
