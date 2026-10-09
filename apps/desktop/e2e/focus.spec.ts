import { test, expect, _electron as electron } from '@playwright/test'

test('the editor and the scope prompt keep focus inside; popovers take it and give it back', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  const focusIn = (testId: string): Promise<boolean> => page.getByTestId(testId).evaluate((el) => el.contains(document.activeElement))

  // Tab walks round the editor, never out into the sidebar behind it.
  await page.keyboard.press('n')
  const editor = page.getByTestId('editor')
  await expect(editor.getByPlaceholder('New Event')).toBeFocused()
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    expect(await focusIn('editor')).toBe(true)
  }
  // Esc in an open picker closes only the picker.
  await editor.getByRole('button', { name: 'Starts time' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Starts time' })).toBeHidden()
  await expect(editor).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)

  // The scope prompt starts on its first choice and keeps focus too.
  await page.getByTestId('view-switch-day').click()
  await page.getByTestId('event-block').filter({ hasText: 'Morning run' }).first().click()
  await page.getByTestId('details').getByRole('button', { name: 'Delete' }).click()
  const prompt = page.getByTestId('scope-prompt')
  await expect(prompt.getByRole('button', { name: 'This event' })).toBeFocused()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await focusIn('scope-prompt')).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(prompt).toHaveCount(0)

  // Details: focus moves to its heading, and back to the row that opened it on close.
  await page.keyboard.press('a')
  const row = page.locator('.ag-row').filter({ hasText: 'Quarterly roadmap sync' })
  await row.dblclick()
  const details = page.getByTestId('details')
  await expect(details.getByRole('heading')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(row).toBeFocused()

  // Invites panel: the same.
  await page.getByTestId('invites-button').click()
  await expect(page.locator('.invites-title')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.invites-panel')).toHaveCount(0)
  await expect(page.getByTestId('invites-button')).toBeFocused()
  await app.close()
})
