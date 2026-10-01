import { test, expect, _electron as electron } from '@playwright/test'

test('a disconnected account prompts for a new password once and reconnects', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1', MYSTICALS_MOCK_AUTH_ERROR: '1' } })
  const page = await app.firstWindow()

  const sheet = page.getByTestId('reauth-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Work is disconnected')
  await expect(sheet).toContainText('Enter a new app password to reconnect')
  await expect(page.getByLabel('App password')).toBeFocused()
  await expect(page.locator('.app-loader')).toBeHidden()
  await page.screenshot({ path: 'e2e/screens/reauth.png' })

  // "Later" dismisses it for good; the sidebar and status bar still offer to reconnect.
  await sheet.getByRole('button', { name: 'Later' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('statusbar')).toContainText('disconnected')
  await page.getByTestId('sidebar-reauth-work').click()
  await expect(sheet).toBeVisible()

  await sheet.getByLabel('App password').fill('new-secret')
  await page.getByTestId('reauth-submit').click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('sidebar-reauth-work')).toBeHidden()
  await expect(page.getByTestId('statusbar')).not.toContainText('disconnected')
  const work = (await page.evaluate(() => window.api.accounts.list())).find((a) => a.id === 'work')
  expect(work?.authError).toBeUndefined()
  await app.close()
})
