import { test, expect, _electron as electron } from '@playwright/test'

test('language: switch to Ukrainian in Settings and back', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()

  // Mock runs see an English OS.
  await expect(page.getByTestId('view-switch-week')).toHaveText('Week')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-general').click()
  await expect(page.getByTestId('language-auto')).toContainText('system: English')
  await expect(page.getByTestId('language-auto').getByRole('radio')).toBeChecked()

  await page.getByTestId('language-uk').click()
  await expect(page.getByTestId('settings-tab-general')).toHaveText('Загальні')
  await expect(page.getByTestId('settings-tab-accounts')).toHaveText('Облікові записи')
  await expect(page.getByTestId('made-in-ukraine')).toContainText('Зроблено в Україні')
  await expect(page.getByTestId('view-switch-week')).toHaveText('Тиждень')
  await expect(page.getByTestId('new-event')).toHaveText('+ нова')
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  // The long Ukrainian tab labels fit whole inside their tabs, and the tabs inside the track.
  const track = (await page.locator('.set-tabs').boundingBox())!
  for (const tab of await page.locator('.set-tabs [role=tab]').all()) {
    const b = (await tab.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(track.x - 0.5)
    expect(b.x + b.width).toBeLessThanOrEqual(track.x + track.width + 0.5)
    expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label))
  expect(menu).toEqual(expect.arrayContaining(['Файл', 'Редагування', 'Вигляд', 'Вікно']))
  await page.screenshot({ path: 'e2e/screens/language-uk.png' })

  await page.getByTestId('language-en').click()
  await expect(page.getByTestId('view-switch-week')).toHaveText('Week')
  await expect(page.getByTestId('settings-tab-general')).toHaveText('General')
  await app.close()
})

test('language: MYSTICALS_LANG=uk shows Ukrainian dates', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1', MYSTICALS_LANG: 'uk' } })
  const page = await app.firstWindow()
  await page.getByTestId('view-switch-month').click()
  const months = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']
  await expect(page.locator('.toolbar-title')).toContainText(new RegExp(months[new Date().getMonth()], 'i'))
  // The status bar's month starts with a capital, like the title.
  const month = months[new Date().getMonth()]
  await expect(page.getByTestId('statusbar')).toContainText(month[0].toUpperCase() + month.slice(1))
  await expect(page.locator('.mg-dows')).toContainText('пн')
  await page.getByTestId('new-event').click()
  await expect(page.getByTestId('editor-save')).toHaveText('Додати подію')
  await page.screenshot({ path: 'e2e/screens/language-uk-month.png' })
  await app.close()
})
