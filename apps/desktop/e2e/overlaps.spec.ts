import { test, expect, _electron as electron } from '@playwright/test'

test('overlapping events too many for a week column fold into "+N", which opens the day', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  await page.evaluate(async () => {
    const at = (h: number): string => new Date(new Date().setHours(h, 0, 0, 0)).toISOString()
    for (const n of [1, 2, 3, 4])
      await window.api.events.create({ accountId: 'work', calendarId: 'work-main', allDay: false, start: at(13), end: at(14), title: `Overlap ${n}` })
  })

  const overlaps = page.getByTestId('event-block').filter({ hasText: 'Overlap' })
  const more = page.getByTestId('more-events')
  await expect(more).toHaveText('+3')
  await expect(more).toHaveAccessibleName('Show 3 more events')
  await expect(overlaps).toHaveCount(1)
  expect((await overlaps.boundingBox())!.width).toBeGreaterThanOrEqual(45)
  await more.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'e2e/screens/overlaps-week.png' })

  await more.click()
  await expect(page.getByTestId('view-switch-day')).toHaveAttribute('aria-selected', 'true')
  await expect(overlaps).toHaveCount(4)
  await expect(more).toHaveCount(0)

  // The day view never folds, however many there are: its "+N" would lead nowhere.
  await page.evaluate(async () => {
    const at = (h: number): string => new Date(new Date().setHours(h, 0, 0, 0)).toISOString()
    for (let n = 5; n <= 16; n++)
      await window.api.events.create({ accountId: 'work', calendarId: 'work-main', allDay: false, start: at(13), end: at(14), title: `Overlap ${n}` })
  })
  await page.setViewportSize({ width: 960, height: 600 })
  await expect(overlaps).toHaveCount(16)
  await expect(more).toHaveCount(0)
  await app.close()
})
