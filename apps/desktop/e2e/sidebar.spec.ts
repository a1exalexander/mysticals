import { test, expect, _electron as electron } from '@playwright/test'

test('sidebar collapses and expands, remembers it, and ⌘\\ / Ctrl+\\ toggles it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  const sidebar = page.getByTestId('sidebar')
  const handle = page.getByTestId('sidebar-handle')

  // Expanded by default: the collapse handle sits on the sidebar's right border, halfway down it.
  await expect(sidebar).toBeVisible()
  await expect(handle).toHaveAttribute('aria-expanded', 'true')
  const sb = (await sidebar.boundingBox())!
  const h = (await handle.boundingBox())!
  expect(Math.abs(h.x + h.width / 2 - (sb.x + sb.width))).toBeLessThan(2)
  expect(Math.abs(h.y + h.height / 2 - (sb.y + sb.height / 2))).toBeLessThan(2)

  await handle.click()
  await expect(sidebar).toBeHidden()
  // The same handle stays on screen, in a slim rail left of the calendar, to bring it back.
  await expect(handle).toBeVisible()
  await expect(handle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeLessThan(40)
  const main = (await page.locator('.main').boundingBox())!
  const hc = (await handle.boundingBox())!
  expect(hc.x).toBeGreaterThanOrEqual(0)
  expect(hc.x + hc.width).toBeLessThanOrEqual(main.x)
  await expect(page.getByTestId('sidebar-toggle')).toHaveCount(0)
  await page.screenshot({ path: 'e2e/screens/sidebar-collapsed.png' })

  // Survives a reload.
  await page.reload()
  await expect(page.locator('.app-loader')).toBeHidden()
  await expect(sidebar).toBeHidden()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backslash' : 'Control+Backslash')
  await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeGreaterThan(200)

  // One handle both hides and shows it.
  await handle.click()
  await expect(sidebar).toBeHidden()
  await handle.click()
  await expect(sidebar).toBeVisible()
  await expect(handle).toHaveAttribute('aria-expanded', 'true')
  await app.close()
})
