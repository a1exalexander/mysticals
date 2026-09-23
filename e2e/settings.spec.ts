import { test, expect, _electron as electron } from '@playwright/test'

test('settings tabs: accounts, themes, sync', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
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
  expect((await settings.boundingBox())?.height).toBeCloseTo(box?.height ?? 0, 0)
  await page.screenshot({ path: 'e2e/screens/settings-themes.png' })

  await page.getByTestId('settings-tab-sync').click()
  await expect(page.getByTestId('sync-work')).toContainText('ok')
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
