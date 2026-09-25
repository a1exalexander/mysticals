import { test, expect, _electron as electron } from '@playwright/test'

test('details follow the window and say when the event was deleted elsewhere', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('event-block').filter({ hasText: 'Dinner with friends' }).first().click()
  const details = page.getByTestId('details')
  await expect(details).toBeVisible()

  // A narrower window: still fully inside it.
  await page.setViewportSize({ width: 820, height: 560 })
  await expect.poll(async () => {
    const b = (await details.boundingBox())!
    return b.x >= 0 && b.x + b.width <= 820 && b.y + b.height <= 560
  }).toBe(true)

  // Deleted by "another device": the popover stays, with a notice and no actions.
  await page.evaluate(async () => {
    const d = new Date()
    const all = await window.api.events.list({ start: d.toISOString(), end: new Date(d.getTime() + 7 * 86_400_000).toISOString() })
    await window.api.events.delete(all.find((e) => e.title === 'Dinner with friends')!)
  })
  await expect(page.getByTestId('details-gone')).toContainText('This event was deleted')
  await expect(details.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await page.getByTestId('details-gone').getByRole('button', { name: 'Close' }).click()
  await expect(details).toHaveCount(0)
  await app.close()
})

test('Google sign-in shows the connecting step once the browser is done', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('accounts:addGoogle')
    ipcMain.handle('accounts:addGoogle', () => new Promise(() => {}))
  })
  await page.getByText('Add calendar').click()
  await page.getByTestId('add-google').click()
  await expect(page.getByText('Waiting for Google sign-in')).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('signin', 'connecting'))
  await expect(page.getByTestId('google-connecting')).toContainText('Connecting your account')
  await app.close()
})

test('CalDAV shows its connecting steps and keeps the form for a retry', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('accounts:addCaldav')
    ipcMain.handle('accounts:addCaldav', () => new Promise((_, reject) => setTimeout(() => reject(new Error('401 Unauthorized')), 800)))
  })
  await page.getByText('Add calendar').click()
  await page.getByTestId('add-caldav').click()
  const sheet = page.getByTestId('accounts-sheet')
  await sheet.getByLabel('Email', { exact: true }).fill('me@acme.io')
  await sheet.getByLabel('App password').fill('secret')
  await page.getByTestId('add-caldav-submit').click()
  await expect(page.getByTestId('caldav-connecting')).toContainText('Signing in to dav.privateemail.com…')
  await expect(sheet.getByLabel('App password')).toBeHidden()
  await expect(sheet.getByRole('alert')).toContainText('401 Unauthorized')
  await expect(page.getByTestId('caldav-connecting')).toHaveCount(0)
  await expect(sheet.getByLabel('Email', { exact: true })).toHaveValue('me@acme.io') // kept for the retry
  await app.close()
})
