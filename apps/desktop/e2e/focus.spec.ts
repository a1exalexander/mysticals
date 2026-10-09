import { test, expect, _electron as electron } from '@playwright/test'
import { stackDialog } from './stackDialog'

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
  await expect(page.getByRole('dialog', { name: 'New Event' })).toBeVisible()
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
  await expect(page.getByRole('dialog', { name: 'Delete recurring event' })).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await focusIn('scope-prompt')).toBe(true)
  }
  // Esc in a dialog stacked on top (Reauth opens by itself) closes that one only.
  await page.evaluate(stackDialog)
  await page.keyboard.press('Escape')
  await expect(page.locator('#on-top')).not.toHaveAttribute('open')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'This event' }).focus()
  await page.keyboard.press('Escape')
  await expect(prompt).toHaveCount(0)

  // Opened with the mouse from a grid event: nothing gets focus back, neither the event (no ring, no tooltip a second
  // later) nor what had keyboard focus before (grid events don't take focus on click).
  const today = page.getByRole('button', { name: 'today', exact: true })
  await today.focus()
  const gym = page.getByTestId('event-block').filter({ hasText: 'Gym' }).first()
  await gym.click()
  const details = page.getByTestId('details')
  await expect(details.getByRole('heading')).toBeFocused()
  await page.mouse.move(5, 790)
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(today).not.toBeFocused()
  await expect(gym).not.toBeFocused()
  await page.waitForTimeout(1200)
  await expect(page.getByTestId('event-tooltip')).toHaveCount(0)

  // Invites panel from the keyboard: focus moves in, and back to its button on close; after a click it doesn't.
  const invites = page.getByTestId('invites-button')
  await invites.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.invites-title')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.invites-panel')).toHaveCount(0)
  await expect(invites).toBeFocused()
  await invites.evaluate((el) => (el as HTMLElement).blur())
  await invites.click()
  await expect(page.locator('.invites-title')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.invites-panel')).toHaveCount(0)
  await expect(invites).not.toBeFocused()
  await app.close()
})
