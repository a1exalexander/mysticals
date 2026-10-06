import { test, expect, _electron as electron } from '@playwright/test'

test('settings tabs: accounts, themes, sync', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()

  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByTestId('settings-sheet')
  const panel = settings.getByRole('tabpanel')
  await expect(page.getByTestId('settings-tab-accounts')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('account-label-work')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Add account…' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Sync now' })).toHaveCount(0)
  const box = await settings.boundingBox()
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'e2e/screens/settings-accounts.png' })

  // Arrow keys move between tabs.
  await page.getByTestId('settings-tab-accounts').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('settings-tab-themes')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('settings-tab-themes')).toBeFocused()
  await page.getByTestId('theme-catppuccin').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin')
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark')
  expect((await settings.boundingBox())?.height).toBeCloseTo(box?.height ?? 0, 0)
  await page.screenshot({ path: 'e2e/screens/settings-themes.png' })
  // Light palettes switch the colour scheme too.
  for (const id of ['mono', 'vscode', 'matrix', 'bubble', 'toon', 'babyblue', 'light'] as const) {
    await page.getByTestId(`theme-${id}`).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', id)
    await expect(page.locator('html')).toHaveAttribute('data-scheme', ['bubble', 'toon', 'babyblue', 'light'].includes(id) ? 'light' : 'dark')
    await page.waitForTimeout(150)
    await page.screenshot({ path: `e2e/screens/settings-theme-${id}.png` })
  }
  await page.getByTestId('theme-dracula').click()

  await page.getByTestId('settings-tab-sync').click()
  await expect(page.getByTestId('sync-work')).toContainText('ok')
  // The thumb slides under the active tab; no extra space under the tabs inside the track.
  await page.waitForTimeout(500)
  const tabBox = await page.getByTestId('settings-tab-sync').boundingBox()
  const thumbBox = await settings.locator('.set-tabs .seg-thumb').boundingBox()
  expect(thumbBox?.x).toBeCloseTo(tabBox?.x ?? 0, 0)
  expect(thumbBox?.width).toBeCloseTo(tabBox?.width ?? 0, 0)
  const trackBox = await settings.locator('.set-tabs').boundingBox()
  expect((trackBox?.height ?? 0) - (tabBox?.height ?? 0)).toBeLessThanOrEqual(4)
  await page.getByTestId('sync-all').click()
  await expect(page.getByTestId('sync-all')).toHaveText('Sync all')
  await expect(page.getByTestId('sync-work')).toContainText('ok')
  await page.screenshot({ path: 'e2e/screens/settings-sync.png' })

  // Last tab is kept after reopening.
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-tab-sync')).toHaveAttribute('aria-selected', 'true')
  await app.close()
})

test('privacy tab: usage stats toggle is on by default and persists', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-privacy').click()
  const toggle = page.getByTestId('telemetry-toggle')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await page.screenshot({ path: 'e2e/screens/settings-privacy.png' })

  // A fresh renderer reads it back from main (prefs.json in userData).
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-privacy').click()
  await expect(page.getByTestId('telemetry-toggle')).not.toBeChecked()
  await app.close()
})
