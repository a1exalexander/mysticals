import { test, expect, _electron as electron } from '@playwright/test'

test('clickable controls use pointer cursor, disabled ones do not', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  const cursor = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).cursor)

  await expect(page.getByTestId('event-block').first()).toBeVisible()
  expect(await cursor('[data-testid^=view-switch-]')).toBe('pointer')
  expect(await cursor('[data-testid=event-block]')).toBe('pointer')
  expect(await cursor('.sb-gear')).toBe('pointer')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-event'))
  await expect(page.getByTestId('editor-save')).toBeDisabled()
  expect(await cursor('[data-testid=editor-save]')).toBe('default')

  await app.close()
})
