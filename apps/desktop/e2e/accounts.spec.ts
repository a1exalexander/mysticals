import { test, expect, _electron as electron } from '@playwright/test'

test('add-account sheet shows inline errors; settings renames an account', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()

  await page.getByRole('button', { name: 'Add calendar' }).click()
  const sheet = page.getByTestId('accounts-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Each account is isolated')

  await page.getByTestId('add-google').click()
  await expect(sheet.getByRole('alert')).toHaveText('Not available in mock mode')

  await page.getByTestId('add-caldav').click()
  await expect(sheet.getByRole('combobox')).toHaveValue('privateemail')
  await expect(sheet.getByLabel('Server URL')).toHaveValue('https://dav.privateemail.com/dav.php/')
  await sheet.getByLabel('Email', { exact: true }).fill('me@acme.io')
  await expect(sheet.getByLabel('Label', { exact: true })).toHaveValue('Work')
  await sheet.getByLabel('App password').fill('secret')
  await sheet.getByRole('radio').nth(2).click()
  await page.getByTestId('add-caldav-submit').click()
  await expect(sheet.getByRole('alert')).toHaveText('Not available in mock mode')
  await page.screenshot({ path: 'e2e/screens/unit8-add.png' })

  await sheet.getByRole('button', { name: 'Back' }).click()
  await page.getByTestId('open-settings').click()
  const settings = page.getByTestId('settings-sheet')
  await expect(settings).toBeVisible()
  await expect(sheet).toBeHidden()
  const label = page.getByTestId('account-label-work')
  await expect(label).toHaveValue('Work')
  await label.fill('Acme')
  await label.press('Enter')
  await expect
    .poll(async () => (await page.evaluate(() => window.api.accounts.list())).find((a) => a.id === 'work')?.label)
    .toBe('Acme')

  await page.getByTestId('account-work').getByRole('button', { name: 'Remove' }).click()
  await expect(settings).toContainText(
    'Removes local data and credentials for me@work.example. Nothing is deleted on the server.'
  )
  await page.screenshot({ path: 'e2e/screens/unit8-settings.png' })
  await app.close()
})
