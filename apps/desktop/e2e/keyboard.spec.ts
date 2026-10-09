import { test, expect, _electron as electron } from '@playwright/test'

test('week view events work from the keyboard: Tab, Enter, the menu key, ↑/↓', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  const blocks = page.getByTestId('event-block')
  await expect(blocks.first()).toBeVisible()

  // Every event is a named control; each day is one Tab stop.
  await expect(page.locator('[data-testid="event-block"]:not([role="button"][tabindex])')).toHaveCount(0)
  await expect(blocks.filter({ hasText: 'Gym' }).first()).toHaveAttribute('aria-label', /^Gym, .+ · 19:00 – 20:00$/)
  const today = page.locator('.tg-col.is-today')
  await expect(today.locator('[data-testid="event-block"][tabindex="0"]')).toHaveCount(1)

  // Tab from the view switch reaches an event in the grid.
  await page.getByTestId('view-switch-week').click()
  const focused = page.locator('.tg-col :focus')
  for (let i = 0; i < 40 && !(await focused.count()); i++) await page.keyboard.press('Tab')
  await expect(focused).toHaveAttribute('data-testid', 'event-block')

  // Enter opens its details; focus stays on the event.
  const title = (await focused.locator('.ev-title').textContent()) ?? ''
  await page.keyboard.press('Enter')
  const details = page.getByTestId('details')
  await expect(details).toBeVisible()
  await expect(details).toContainText(title)
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()

  // The menu key and Shift+F10 open its menu, with an item focused; closing it hands focus back to the pill.
  // Retried: a scroll (focusing scrolls the grid) closes menus and may land after the key.
  const menu = page.getByTestId('event-menu')
  const stop = today.locator('[tabindex="0"]')
  await stop.focus()
  for (const key of ['ContextMenu', 'Shift+F10']) {
    await expect(async () => {
      await page.keyboard.press(key)
      await page.waitForTimeout(150)
      await expect(menu).toBeVisible({ timeout: 100 })
    }).toPass()
    await expect(menu.locator('button:focus')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(stop).toBeFocused()
  }
  // Choosing an item too (Copy only shows a toast).
  await page.keyboard.press('ContextMenu')
  await menu.getByTestId('menu-copy').focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(stop).toBeFocused()
  const rightClick = (): Promise<void> =>
    expect(async () => {
      await stop.click({ button: 'right' })
      await page.waitForTimeout(150)
      await expect(menu).toBeVisible({ timeout: 100 })
    }).toPass()
  // A right-click on the pill that already has keyboard focus: it gets it back.
  await rightClick()
  await page.keyboard.press('Escape')
  await expect(stop).toBeFocused()
  // A mouse user's right-click leaves no focus behind: no ring, and no tooltip a second later.
  await stop.evaluate((el) => (el as HTMLElement).blur())
  await rightClick()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(stop).not.toBeFocused()
  await page.waitForTimeout(1200)
  await expect(page.getByTestId('event-tooltip')).toHaveCount(0)

  // ↓ steps to the day's next event, Space opens it.
  await stop.focus()
  const top = await stop.evaluate((el) => (el as HTMLElement).offsetTop)
  await page.keyboard.press('ArrowDown')
  const next = today.locator(':focus')
  await expect(next).toHaveAttribute('tabindex', '-1')
  expect(await next.evaluate((el) => (el as HTMLElement).offsetTop)).toBeGreaterThan(top)
  await page.keyboard.press('Space')
  await expect(details).toBeVisible()
  await page.keyboard.press('Escape')

  // ←/→ (h/l) step to the neighbouring day's events and leave the period alone; so do t and the view keys.
  const stops = page.locator('.tg-col > [tabindex="0"]')
  const i = await stops.evaluateAll((els) => els.findIndex((el) => el.parentElement?.classList.contains('is-today')))
  const left = i > 0
  const period = (await page.locator('.toolbar-title').textContent()) ?? ''
  await stop.focus()
  await page.keyboard.press(left ? 'ArrowLeft' : 'ArrowRight')
  await expect(stops.nth(left ? i - 1 : i + 1)).toBeFocused()
  await page.keyboard.press(left ? 'l' : 'h')
  await expect(stop).toBeFocused()
  for (const key of ['t', 'm', 'd']) await page.keyboard.press(key)
  await expect(stop).toBeFocused()
  await expect(page.locator('.toolbar-title')).toHaveText(period)
  await expect(page.locator('.tg-dayhead')).toHaveCount(7)

  // A day's header is a button that opens that day.
  await page.locator('button.tg-dayhead').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.tg-single')).toBeVisible()

  // A focused invite awaiting a reply (tomorrow's Sprint planning) shows the ring, not its dashed outline.
  await page.locator('.today-btn').click()
  await page.keyboard.press('ArrowRight')
  const invite = page.locator('.ev.is-pending')
  await expect(invite).toBeVisible()
  await page.locator('.tg-col > [tabindex="0"]').focus()
  for (let i = 0; i < 5 && !(await invite.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown')
  await expect(invite).toBeFocused()
  await expect(invite).toHaveCSS('outline-style', 'solid')

  await app.close()
})
