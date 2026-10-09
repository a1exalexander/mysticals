import { test, expect, _electron as electron, type Locator, type Page } from '@playwright/test'

const launch = async (): Promise<{ app: Awaited<ReturnType<typeof electron.launch>>; page: Page }> => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  await page.getByTestId('view-switch-day').click()
  return { app, page }
}

/** Right-click until the menu stays: the day view's own scroll-to-now (which closes menus) may land after the click. */
const rightClick = async (
  page: Page, target: string | Locator, menu = 'event-menu', position?: { x: number; y: number }
): Promise<void> => {
  const el = typeof target === 'string' ? page.getByTestId('event-block').filter({ hasText: target }).first() : target
  await expect(async () => {
    await el.click({ button: 'right', position })
    await page.waitForTimeout(150)
    await expect(page.getByTestId(menu)).toBeVisible({ timeout: 100 })
  }).toPass()
}

test('right-click an event: edit, duplicate, copy and paste, delete with undo', async () => {
  const { app, page } = await launch()
  const blocks = (title: string) => page.getByTestId('event-block').filter({ hasText: title })
  const menu = page.getByTestId('event-menu')
  const toast = page.getByTestId('toast')

  await rightClick(page, 'Gym')
  for (const id of ['edit', 'duplicate', 'copy', 'delete']) {
    await expect(menu.getByTestId(`menu-${id}`)).toBeEnabled()
    await expect(menu.getByTestId(`menu-${id}`).locator('svg')).toHaveCount(1)
  }
  await page.screenshot({ path: 'e2e/screens/event-menu.png' })
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // Edit opens the editor on it.
  await blocks('Gym').first().click({ button: 'right' })
  await menu.getByTestId('menu-edit').click()
  await expect(page.locator('.editor input').first()).toHaveValue('Gym')
  await page.keyboard.press('Escape')

  // Duplicate makes a second one at once; Undo takes it away.
  await blocks('Gym').first().click({ button: 'right' })
  await menu.getByTestId('menu-duplicate').click()
  await expect(toast).toContainText('Duplicated “Gym”')
  await expect(toast).toHaveCSS('border-radius', '6px') // the menus' and popovers' corner
  await expect(blocks('Gym')).toHaveCount(2)
  await toast.getByRole('button').click()
  await expect(blocks('Gym')).toHaveCount(1)

  // Copy, then right-click a free time: paste puts it there.
  await blocks('Gym').first().click({ button: 'right' })
  await menu.getByTestId('menu-copy').click()
  await expect(toast).toContainText('Copied “Gym”')
  await rightClick(page, page.locator('.tg-col').first(), 'slot-menu', { x: 20, y: 48 * 15 + 10 })
  const slot = page.getByTestId('slot-menu')
  await expect(slot.getByTestId('menu-paste')).toHaveText('Paste “Gym”')
  await slot.getByTestId('menu-paste').click()
  await expect(toast).toContainText('Pasted “Gym”')
  await expect(blocks('Gym')).toHaveCount(2)
  await expect(blocks('Gym').filter({ hasText: '15:00' })).toHaveCount(1)

  // A single event goes at once; Undo brings it back.
  await blocks('Gym').filter({ hasText: '15:00' }).click({ button: 'right' })
  await menu.getByTestId('menu-delete').click()
  await expect(page.getByTestId('scope-prompt')).toHaveCount(0)
  await expect(toast).toContainText('Deleted “Gym”')
  await expect(blocks('Gym')).toHaveCount(1)
  await toast.getByRole('button').click()
  await expect(blocks('Gym')).toHaveCount(2)
  await app.close()
})

test('details popover: Delete works like the menu, at once with Undo', async () => {
  const { app, page } = await launch()
  const gym = page.getByTestId('event-block').filter({ hasText: 'Gym' })
  const details = page.getByTestId('details')
  const toast = page.getByTestId('toast')
  // Click until the popover stays: the day view's scroll-to-now may close it.
  await expect(async () => {
    await gym.click()
    await page.waitForTimeout(150)
    await expect(details).toBeVisible({ timeout: 100 })
  }).toPass()
  await details.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('details')).toBeHidden()
  await expect(page.getByTestId('scope-prompt')).toHaveCount(0)
  await expect(toast).toContainText('Deleted “Gym”')
  await expect(gym).toHaveCount(0)
  await toast.getByRole('button').click()
  await expect(gym).toHaveCount(1)
  await app.close()
})

test('right-click: a recurring event asks what to delete; a read-only one offers nothing', async () => {
  const { app, page } = await launch()
  const menu = page.getByTestId('event-menu')

  await rightClick(page, 'Morning run')
  await expect(menu.getByTestId('menu-delete')).toBeEnabled()
  await menu.getByTestId('menu-delete').click()
  const prompt = page.getByTestId('scope-prompt')
  await expect(prompt).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(prompt).toBeHidden()
  await expect(page.getByTestId('event-block').filter({ hasText: 'Morning run' })).toHaveCount(1)

  // Holidays is a read-only calendar: nothing to change, and no copy can go into it.
  await rightClick(page, 'Holiday')
  for (const id of ['edit', 'duplicate', 'copy', 'delete']) await expect(menu.getByTestId(`menu-${id}`)).toBeDisabled()
  await app.close()
})
