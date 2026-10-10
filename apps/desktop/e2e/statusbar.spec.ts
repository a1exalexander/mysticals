import { test, expect, _electron as electron } from '@playwright/test'

test('status bar shows current and next events', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()

  // A meeting happening right now; the daily standup mock guarantees a "next" within 24h.
  await page.evaluate(() => {
    const now = Date.now()
    return window.api.events.create({
      accountId: 'work', calendarId: 'work-main', title: 'Status sync', allDay: false,
      start: new Date(now - 10 * 60_000).toISOString(), end: new Date(now + 30 * 60_000).toISOString()
    })
  })

  const bar = page.getByTestId('sbar-events')
  await expect(bar).toContainText('Status sync')
  await expect(bar).toContainText('until')
  await expect(bar).toContainText('next:')
  await page.screenshot({ path: 'e2e/screens/statusbar.png' })

  await bar.getByRole('button', { name: /Status sync/ }).click()
  await expect(page.getByTestId('details')).toContainText('Status sync')
  await app.close()
})

test('an untitled event reads Untitled in the week grid, the status bar and its details', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  await page.getByTestId('view-switch-week').click()

  await page.evaluate(() => {
    const now = Date.now()
    return window.api.events.create({
      accountId: 'work', calendarId: 'work-main', title: '', allDay: false,
      start: new Date(now - 10 * 60_000).toISOString(), end: new Date(now + 30 * 60_000).toISOString()
    })
  })

  await expect(page.getByTestId('sbar-events').getByRole('button', { name: /Untitled/ })).toHaveAttribute('title', 'Untitled')
  const block = page.getByTestId('event-block').filter({ hasText: 'Untitled' }).first()
  await expect(block).toBeVisible()
  await block.click()
  await expect(page.getByRole('dialog', { name: 'Untitled' })).toBeVisible()
  await app.close()
})

test('the sync error opens Settings on Accounts, whatever tab was used last', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1', MYSTICALS_MOCK_SYNC_ERROR: '1' } })
  const page = await app.firstWindow()
  await expect(page.locator('.app-loader')).toBeHidden()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-logs').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-sheet')).toBeHidden()

  await page.getByTestId('statusbar').getByRole('button', { name: 'sync error' }).click()
  await expect(page.getByTestId('settings-sheet')).toBeVisible()
  await expect(page.getByTestId('settings-tab-accounts')).toHaveAttribute('aria-selected', 'true')
  await app.close()
})
