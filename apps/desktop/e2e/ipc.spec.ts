import { test, expect, _electron as electron } from '@playwright/test'

test('ipc rejects cross-account writes and native menu exists', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()

  const error = await page.evaluate(() =>
    window.api.events
      .create({
        accountId: 'personal',
        calendarId: 'work-main',
        title: 'Leak',
        start: new Date().toISOString(),
        end: new Date(Date.now() + 3600_000).toISOString(),
        allDay: false
      })
      .then(
        () => 'created',
        (e: Error) => e.message
      )
  )
  expect(error).toMatch(/does not belong/)

  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label))
  expect(labels).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Window']))

  await page.screenshot({ path: 'e2e/screens/unit5.png' })
  await app.close()
})
