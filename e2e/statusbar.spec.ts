import { test, expect, _electron as electron } from '@playwright/test'

test('status bar shows current and next events', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
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
