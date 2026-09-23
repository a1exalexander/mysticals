import { test, expect, _electron as electron } from '@playwright/test'

const range = { start: new Date(Date.now() - 864e5 * 30).toISOString(), end: new Date(Date.now() + 864e5 * 30).toISOString() }

test('recurring delete: "This and following" keeps earlier instances only', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('view-switch-day').click()
  const runs = async (): Promise<string[]> =>
    (await page.evaluate((r) => window.api.events.list(r), range)).filter((e) => e.title === 'Morning run').map((e) => e.start)
  const all = await runs()
  expect(all).toHaveLength(7)

  await page.getByTestId('event-block').filter({ hasText: 'Morning run' }).first().click()
  const details = page.getByTestId('details')
  await details.getByRole('button', { name: 'Delete' }).click()
  await expect(details).toContainText('Delete recurring event')
  await page.screenshot({ path: 'e2e/screens/recurring-delete.png' })
  await details.getByRole('button', { name: 'This and following' }).click()
  await expect(details).toBeHidden()

  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
  await expect.poll(runs).toEqual(all.filter((s) => s < todayStart))
  await app.close()
})

test('toolbar "+ new" opens the editor; custom picker sets date and time', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('new-event').click()
  const editor = page.getByTestId('editor')
  await expect(editor).toBeVisible()
  await page.getByTestId('editor-account').selectOption('personal')
  await editor.getByPlaceholder('New Event').fill('Picked')

  await editor.getByRole('button', { name: 'Starts date' }).click()
  const cal = page.getByRole('dialog', { name: 'Starts date' })
  await expect(cal).toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'e2e/screens/picker-date.png' })
  await cal.locator('.rdp-day:not(.rdp-outside) button', { hasText: /^15$/ }).click()
  await expect(cal).toBeHidden()
  await expect(editor.getByRole('button', { name: 'Starts date' })).toContainText(' 15 ')

  await editor.getByRole('button', { name: 'Starts time' }).click()
  const times = page.getByRole('dialog', { name: 'Starts time' })
  await expect(times).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/picker-time.png' })
  await times.getByRole('option', { name: '09:30' }).click()
  await expect(editor.getByRole('button', { name: 'Starts time' })).toHaveText('09:30')

  // Typed off-grid time; Esc closes only the picker, not the editor.
  await editor.getByRole('button', { name: 'Ends time' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Ends time' })).toBeHidden()
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Ends date' })).toContainText(' 15 ')
  await editor.getByRole('button', { name: 'Ends time' }).click()
  await page.getByLabel('Ends time, HH:mm').fill('10:05')
  await page.keyboard.press('Enter')
  await expect(editor.getByRole('button', { name: 'Ends time' })).toHaveText('10:05')
  await page.screenshot({ path: 'e2e/screens/picker-editor.png' })

  await page.getByTestId('editor-save').click()
  await expect(editor).toBeHidden()
  const picked = async () =>
    (await page.evaluate((r) => window.api.events.list(r), { start: '2000-01-01T00:00:00Z', end: '2100-01-01T00:00:00Z' })).find((e) => e.title === 'Picked')
  await expect.poll(picked).toBeTruthy()
  const ev = (await picked())!
  const start = new Date(ev.start)
  const end = new Date(ev.end)
  expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([15, 9, 30])
  expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([15, 10, 5])
  await app.close()
})
