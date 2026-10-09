import { test, expect, _electron as electron } from '@playwright/test'

test('settings tabs: accounts (with sync and notifications), themes, general', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()

  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByTestId('settings-sheet')
  const panel = settings.getByRole('tabpanel')
  await expect(page.getByTestId('settings-tab-accounts')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('account-label-work')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Add account…' })).toBeVisible()
  // Sync and notifications live on each account's one card, not in tabs of their own.
  await expect(page.getByTestId('sync-work')).toContainText('Up to date')
  await expect(page.getByTestId('account-work').getByTestId('notify-account-work')).toBeVisible()
  // Colour swatches read out by name, not hex.
  const work = page.getByTestId('account-work')
  await expect(work.getByRole('radio', { name: 'Cyan' })).toHaveAttribute('aria-checked', 'true')
  // Arrows step from the focused swatch: two in a row, the second before the first colour has come back over IPC.
  await work.getByRole('radio', { name: 'Cyan' }).focus()
  const arrows = (key: string): Promise<void> =>
    page.evaluate((key) => {
      for (let i = 0; i < 2; i++) document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }, key)
  await arrows('ArrowRight')
  await expect(work.getByRole('radio', { name: 'Orange' })).toBeFocused()
  await expect(work.getByRole('radio', { name: 'Orange' })).toHaveAttribute('tabindex', '0')
  await expect(work.getByRole('radio', { name: 'Orange' })).toHaveAttribute('aria-checked', 'true')
  await arrows('ArrowLeft')
  await expect(work.getByRole('radio', { name: 'Cyan' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('reminder-select')).toBeVisible()
  await expect(page.getByTestId('settings-tab-sync')).toHaveCount(0)
  await expect(page.getByTestId('settings-tab-notifications')).toHaveCount(0)
  const box = await settings.boundingBox()
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'e2e/screens/settings-accounts.png' })

  // The sections are listed down the left side; arrow keys move between them.
  const accBox = (await page.getByTestId('settings-tab-accounts').boundingBox())!
  const themesBox = (await page.getByTestId('settings-tab-themes').boundingBox())!
  expect(themesBox.y).toBeGreaterThan(accBox.y)
  expect(themesBox.x).toBeCloseTo(accBox.x, 0)
  expect((await panel.boundingBox())!.x).toBeGreaterThan(accBox.x + accBox.width)
  await page.getByTestId('settings-tab-accounts').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('settings-tab-themes')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('settings-tab-themes')).toBeFocused()
  // The scrolling panel clips at its edges: the top-left card leaves room for a focus outline (2px, 1px off),
  // and the selected ring is drawn inside the card.
  const firstCard = (await page.getByTestId('theme-dracula').boundingBox())!
  const panelBox = (await panel.boundingBox())!
  expect(firstCard.x - 3).toBeGreaterThanOrEqual(panelBox.x - 0.5)
  expect(firstCard.y - 3).toBeGreaterThanOrEqual(panelBox.y - 0.5)
  // The themes are one radio group: a single Tab stop, and the arrow keys move the selection.
  await expect(page.getByTestId('theme-tokyo')).toHaveAttribute('tabindex', '-1')
  await page.getByTestId('theme-dracula').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'tokyo')
  await expect(page.getByTestId('theme-tokyo')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('theme-tokyo')).toBeFocused()
  await expect(page.getByTestId('theme-tokyo')).toHaveAttribute('tabindex', '0')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula')
  await page.getByTestId('theme-catppuccin').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin')
  await expect(page.getByTestId('theme-catppuccin')).toHaveCSS('box-shadow', /inset/)
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark')
  expect((await settings.boundingBox())?.height).toBeCloseTo(box?.height ?? 0, 0)
  await page.screenshot({ path: 'e2e/screens/settings-themes.png' })
  // Light palettes switch the colour scheme too.
  for (const id of ['mono', 'vscode', 'matrix', 'bubble', 'toon', 'cloud', 'light'] as const) {
    await page.getByTestId(`theme-${id}`).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', id)
    await expect(page.locator('html')).toHaveAttribute('data-scheme', ['bubble', 'toon', 'cloud', 'light'].includes(id) ? 'light' : 'dark')
    await page.waitForTimeout(150)
    await page.screenshot({ path: `e2e/screens/settings-theme-${id}.png` })
  }
  await page.getByTestId('theme-dracula').click()

  await page.getByTestId('settings-tab-events').click()
  // The thumb slides under the active tab, and the sheet keeps its size across tabs.
  await page.waitForTimeout(500)
  const tabBox = await page.getByTestId('settings-tab-events').boundingBox()
  const thumbBox = await settings.locator('.set-tabs .seg-thumb').boundingBox()
  expect(thumbBox?.y).toBeCloseTo(tabBox?.y ?? 0, 0)
  expect(thumbBox?.height).toBeCloseTo(tabBox?.height ?? 0, 0)
  expect(thumbBox?.width).toBeCloseTo(tabBox?.width ?? 0, 0)
  expect((await settings.boundingBox())?.height).toBeCloseTo(box?.height ?? 0, 0)
  await page.getByTestId('settings-tab-accounts').click()
  await page.getByTestId('sync-all').click()
  await expect(page.getByTestId('sync-all')).toHaveText('Sync all')
  await expect(page.getByTestId('sync-work')).toContainText('Up to date')
  await page.getByTestId('settings-tab-events').click()

  // Last tab is kept after reopening.
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-tab-events')).toHaveAttribute('aria-selected', 'true')
  await app.close()
})

test('general tab: usage stats toggle is on by default and persists', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-general').click()
  const toggle = page.getByTestId('telemetry-toggle')
  await expect(toggle).toBeChecked()
  // Drawn as a square box, not stretched by the sheet's text-field styles.
  const box = (await toggle.boundingBox())!
  expect(box.width).toBe(box.height)
  await toggle.uncheck()
  await page.screenshot({ path: 'e2e/screens/settings-privacy.png' })

  // A fresh renderer reads it back from main (prefs.json in userData).
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-general').click()
  await expect(page.getByTestId('telemetry-toggle')).not.toBeChecked()
  await app.close()
})

test('settings scroll as one area in the smallest window', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 960, height: 600 })
  await page.getByRole('button', { name: 'Settings' }).click()
  const detail = page.getByTestId('account-work')
  await expect(detail).toBeVisible()
  // The account details grow with their content; only the panel around them scrolls.
  const nested = await detail.evaluate((el) => {
    const out: string[] = []
    for (let e: Element | null = el; e && !e.classList.contains('set-panel'); e = e.parentElement)
      if (/auto|scroll/.test(getComputedStyle(e).overflowY)) out.push(e.className)
    return out
  })
  expect(nested).toEqual([])
  await detail.getByRole('button', { name: 'Remove', exact: true }).click()
  const confirm = detail.getByRole('button', { name: 'Remove account' })
  await confirm.scrollIntoViewIfNeeded()
  await expect(confirm).toBeInViewport()
  await page.screenshot({ path: 'e2e/screens/settings-960.png' })
  await app.close()
})
