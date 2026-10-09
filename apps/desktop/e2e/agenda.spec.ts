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
  // The focus outline sits inside the row, so the scrolling list can't clip it.
  await row.focus()
  await expect(row).toHaveCSS('outline-offset', '-2px')
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
  // Free time between events: run 07:00–07:45, standup 10:00–10:15, sync 11:30–12:00, gym 19:00.
  await expect(page.getByTestId('agenda-gap')).toHaveText(['Break · 2h 15m', 'Break · 1h 15m', 'Break · 7h'])

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

test('agenda: the now line crosses a running event instead of sitting below it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  // Halfway through the mock's sync (11:30–12:00).
  const today = new Date()
  await page.clock.setFixedTime(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 45))

  await page.keyboard.press('a')
  const row = page.locator('.ag-rows > li').filter({ has: page.locator('.ag-row[data-live="true"]') })
  await expect(row.getByTestId('agenda-now')).toBeVisible()
  await expect(page.getByTestId('agenda-now')).toHaveCount(1)
  const line = (await row.getByTestId('agenda-now').boundingBox())!
  const box = (await row.boundingBox())!
  expect(line.y).toBeGreaterThan(box.y + box.height * 0.3)
  expect(line.y).toBeLessThan(box.y + box.height * 0.7)
  // In the time column only: the title is never struck through, and the clock covers neither it nor the Join pill.
  const title = (await row.locator('.ag-title').boundingBox())!
  const clock = (await row.locator('.ag-now-clock').boundingBox())!
  const pill = (await row.locator('.ag-join-pill').boundingBox())!
  expect(line.x + line.width).toBeLessThanOrEqual(title.x)
  expect(clock.x + clock.width).toBeLessThanOrEqual(title.x)
  expect(clock.x + clock.width).toBeLessThanOrEqual(pill.x)
  await page.screenshot({ path: 'e2e/screens/agenda-now-running.png' })
  await app.close()
})

test('agenda: the focus card shows the organizer, the description and a clickable link', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  await page.evaluate(async () => {
    const at = (min: number): string => new Date(Date.now() + min * 60_000).toISOString()
    await window.api.events.create({
      accountId: 'work', calendarId: 'work-main', allDay: false, start: at(1), end: at(2), title: 'Card check',
      location: 'https://meet.google.com/aqp-oxgt-gmm', description: 'Agenda: <b>roadmap</b> and notes https://example.com/doc'
    })
  })

  await page.keyboard.press('a')
  await page.locator('.ag-row').filter({ hasText: 'Card check' }).click()
  const card = page.getByTestId('agenda-focus')
  await expect(card.getByTestId('agenda-organizer')).toHaveText('me@work.example')
  await expect(card.getByTestId('agenda-link')).toHaveAttribute('href', 'https://meet.google.com/aqp-oxgt-gmm')
  await expect(card.locator('.ag-notes')).toContainText('roadmap')
  await expect(card.locator('.ag-notes a')).toHaveAttribute('href', 'https://example.com/doc')
  await page.screenshot({ path: 'e2e/screens/agenda-focus-notes.png' })
  await app.close()
})

test('agenda: a long focus card scrolls inside the pane, Join and Details stay reachable', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1000, height: 640 })
  await expect(page.locator('.app-loader')).toBeHidden()
  // After the mock's last event today, so the call below is the only one running.
  const today = new Date()
  await page.clock.setFixedTime(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 21, 0))
  await page.evaluate(async () => {
    const at = (min: number): string => new Date(Date.now() + min * 60_000).toISOString()
    await window.api.events.create({
      accountId: 'work', calendarId: 'work-main', allDay: false, start: at(-10), end: at(20), title: 'All hands',
      location: 'https://zoom.us/j/555', attendees: Array.from({ length: 24 }, (_, i) => `guest${i}@work.example`),
      description: Array.from({ length: 40 }, (_, i) => `Point ${i + 1}: a long note that wraps over a line or two in the card.`).join('\n')
    })
  })

  await page.keyboard.press('a')
  const card = page.getByTestId('agenda-focus')
  await expect(card).toContainText('All hands')
  await card.getByTestId('agenda-people-toggle').click()
  await expect(card.getByTestId('agenda-people')).toBeVisible()
  const bar = (await page.locator('.statusbar').boundingBox())!
  const box = (await card.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y)
  const join = page.getByTestId('agenda-join')
  await join.scrollIntoViewIfNeeded()
  const j = (await join.boundingBox())!
  expect(j.y + j.height).toBeLessThanOrEqual(bar.y)
  await page.screenshot({ path: 'e2e/screens/agenda-long-card.png' })
  await card.locator('.ag-details').click()
  await expect(page.getByTestId('details')).toBeVisible()
  await app.close()
})

test('agenda: Enter activates the focused control and only joins from the list', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = async (url: string) => void g.opened.push(url)
  })
  const opened = (): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  // Halfway through the mock's sync (11:30–12:00, Zoom link), so Enter could join it.
  const today = new Date()
  await page.clock.setFixedTime(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 45))

  await page.keyboard.press('a')
  await expect(page.getByTestId('agenda-join')).toBeVisible()
  const toggle = page.getByTestId('agenda-ahead-toggle')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('agenda-upcoming')).toBeVisible()
  await page.locator('.ag-details').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('details')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('details')).toBeHidden()
  expect(await opened()).toEqual([])

  // A clicked row keeps focus; Enter there still joins the selected call.
  await page.locator('.ag-row').filter({ hasText: 'Quarterly roadmap sync' }).click()
  await page.keyboard.press('Enter')
  await expect.poll(opened).toEqual(['https://zoom.us/j/1234567890?pwd=abc'])
  await app.close()
})
