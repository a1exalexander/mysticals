import { test, expect, _electron as electron } from '@playwright/test'

test('agenda lists today and offers Join from 5 minutes before a call', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  // The mock seeds "Quarterly roadmap sync with design" today 11:30–12:00 with a Zoom link in its location.
  const today = new Date()
  await page.clock.setFixedTime(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 26))

  await page.keyboard.press('a')
  await expect(page.getByTestId('agenda')).toBeVisible()
  await expect(page.getByTestId('view-switch-agenda')).toHaveAttribute('aria-selected', 'true')
  const row = page.locator('.ag-row').filter({ hasText: 'Quarterly roadmap sync' })
  await row.click()
  const focus = page.getByTestId('agenda-focus')
  await expect(focus).toContainText('Quarterly roadmap sync with design')
  await expect(focus).toContainText('https://zoom.us/j/1234567890?pwd=abc')
  await expect(page.getByTestId('agenda-join')).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/agenda.png' })

  // The slider sits under the active tab.
  await page.getByTestId('view-switch-week').click()
  await expect(page.getByTestId('agenda')).toHaveCount(0)
  const tab = (await page.getByTestId('view-switch-week').boundingBox())!
  await expect.poll(async () => Math.abs((await page.locator('.seg-thumb').boundingBox())!.x - tab.x)).toBeLessThan(1.5)
  await page.screenshot({ path: 'e2e/screens/tabs.png', clip: { x: 0, y: 0, width: 1200, height: 60 } })
  await app.close()
})

test('reads well from the minimum window size up; narrow agenda drops the focus card', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.locator('.app-loader')).toBeHidden()
  const today = new Date()
  await page.clock.setFixedTime(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 26))
  const toolbarFits = (): Promise<boolean> =>
    page.locator('.toolbar').evaluate((el) => el.scrollWidth <= el.clientWidth && [...el.children].every((c) => c.getBoundingClientRect().right <= el.getBoundingClientRect().right))

  for (const [w, h] of [[960, 600], [1200, 800], [1600, 1000]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.getByTestId('view-switch-week').click()
    expect(await toolbarFits()).toBe(true)
    await page.getByTestId('event-block').filter({ hasText: 'Quarterly roadmap sync' }).first().click()
    await expect(page.getByTestId('details')).toBeVisible()
    await page.screenshot({ path: `e2e/screens/size-${w}-details.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('n')
    await expect(page.getByTestId('editor')).toBeVisible()
    await page.screenshot({ path: `e2e/screens/size-${w}-editor.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeHidden()

    await page.getByTestId('view-switch-agenda').click()
    await page.locator('.ag-row').filter({ hasText: 'Quarterly roadmap sync' }).click()
    expect(await toolbarFits()).toBe(true)
    // 960 leaves a 720px main pane: list only, Join stays on the row.
    await expect(page.getByTestId('agenda-focus')).toBeVisible({ visible: w > 960 })
    await expect(page.locator('.ag-join-pill')).toBeVisible()
    await page.screenshot({ path: `e2e/screens/size-${w}-agenda.png`, animations: 'disabled' })
  }
  await app.close()
})

test('agenda: no stale card after the day, a now line, people toggle, and other days greyed with a way back', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  // After the mock's last event today (Gym 19:00–20:00).
  const today = new Date()
  await page.clock.setFixedTime(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 21, 0))

  await page.keyboard.press('a')
  await expect(page.getByTestId('agenda')).toBeVisible()
  await expect(page.getByTestId('agenda-focus')).toHaveCount(0)
  await expect(page.getByTestId('agenda-focus-empty')).toBeVisible()
  await expect(page.getByTestId('agenda-now')).toBeVisible()
  await expect(page.getByTestId('agenda-other-day')).toHaveCount(0)

  // Picking an ended event shows it; clicking it again hides the card.
  const standup = page.locator('.ag-row').filter({ hasText: 'Daily standup' })
  await standup.click()
  await expect(page.getByTestId('agenda-focus')).toContainText('Daily standup')
  await page.getByTestId('agenda-people-toggle').click()
  await expect(page.getByTestId('agenda-people')).toContainText('lead@work.example')
  await page.screenshot({ path: 'e2e/screens/agenda-people.png' })
  await page.getByTestId('agenda-people-toggle').click()
  await expect(page.getByTestId('agenda-people')).toHaveCount(0)
  await standup.click()
  await expect(page.getByTestId('agenda-focus')).toHaveCount(0)

  // The next 7 days open below the day; the toggle stays after today's rows and hides them again.
  const toggle = page.getByTestId('agenda-ahead-toggle')
  await expect(toggle).toContainText('Next 7 days')
  await toggle.click()
  const upcoming = page.getByTestId('agenda-upcoming')
  await expect(upcoming).toContainText('Sprint planning')
  await expect(upcoming).toContainText('Dinner with friends')
  await expect(toggle).toContainText('Hide upcoming')
  expect((await toggle.boundingBox())!.y).toBeGreaterThan((await page.locator('.ag-row').filter({ hasText: 'Gym' }).boundingBox())!.y)
  expect((await toggle.boundingBox())!.y).toBeLessThan((await upcoming.boundingBox())!.y)
  await upcoming.locator('.ag-row').filter({ hasText: 'Sprint planning' }).click()
  await expect(page.getByTestId('agenda-focus')).toContainText('Sprint planning')
  await page.screenshot({ path: 'e2e/screens/agenda-ahead.png' })
  await toggle.click()
  await expect(upcoming).toHaveCount(0)
  await expect(toggle).toContainText('Next 7 days')

  // Tomorrow: greyed, a notice, no now line; the notice's button comes back to today.
  await page.locator('.toolbar-nav').getByRole('button', { name: 'Next' }).click()
  await expect(page.getByTestId('agenda-other-day')).toBeVisible()
  await expect(page.locator('.ag[data-other-day]')).toHaveCount(1)
  await expect(page.getByTestId('agenda-now')).toHaveCount(0)
  await expect(page.locator('.ag-row').filter({ hasText: 'Sprint planning' })).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/agenda-other-day.png' })
  await page.getByTestId('agenda-back-today').click()
  await expect(page.getByTestId('agenda-other-day')).toHaveCount(0)
  await expect(page.getByTestId('agenda-now')).toBeVisible()
  await app.close()
})
