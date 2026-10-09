import { test, expect, _electron as electron } from '@playwright/test'
import { choose } from './choose'

const range = { start: new Date(Date.now() - 864e5 * 30).toISOString(), end: new Date(Date.now() + 864e5 * 30).toISOString() }

test('recurring delete: "This and following" keeps earlier instances only', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('view-switch-day').click()
  const runs = async (): Promise<string[]> =>
    (await page.evaluate((r) => window.api.events.list(r), range)).filter((e) => e.title === 'Morning run').map((e) => e.start)
  const all = await runs()
  expect(all).toHaveLength(7)

  await page.getByTestId('event-block').filter({ hasText: 'Morning run' }).first().click()
  const details = page.getByTestId('details')
  // The same flow as right-click: the popover closes and the scope prompt asks.
  await details.getByRole('button', { name: 'Delete' }).click()
  await expect(details).toBeHidden()
  const prompt = page.getByTestId('scope-prompt')
  await expect(prompt).toContainText('Delete recurring event')
  // Each choice carries an icon of how much of the series it takes, in delete red.
  for (const name of ['This event', 'This and following', 'All events', 'Cancel']) {
    await expect(prompt.getByRole('button', { name }).locator('svg')).toHaveCount(1)
  }
  await expect(prompt.getByRole('button', { name: 'All events' })).toHaveClass(/danger/)
  await page.screenshot({ path: 'e2e/screens/recurring-delete.png' })
  await prompt.getByRole('button', { name: 'This and following' }).click()
  await expect(prompt).toBeHidden()

  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
  await expect.poll(runs).toEqual(all.filter((s) => s < todayStart))
  await app.close()
})

test('recurring edit: saving asks the scope; "All events" renames every instance', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('view-switch-day').click()
  const titles = async (): Promise<string[]> =>
    (await page.evaluate((r) => window.api.events.list(r), range)).filter((e) => e.recurringEventId === 'run-series').map((e) => e.title)

  await page.getByTestId('event-block').filter({ hasText: 'Morning run' }).first().click()
  await page.getByTestId('details').getByRole('button', { name: 'Edit' }).click()
  const editor = page.getByTestId('editor')
  await editor.getByPlaceholder('Title').fill('Evening run')
  await page.getByTestId('editor-save').click()
  const scope = editor.getByRole('group', { name: 'Save recurring event' })
  await expect(scope).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/recurring-edit.png' })
  // Esc goes back to the form without saving.
  await page.keyboard.press('Escape')
  await expect(scope).toBeHidden()
  await expect(editor).toBeVisible()
  await page.getByTestId('editor-save').click()
  await scope.getByRole('button', { name: 'All events' }).click()
  await expect(editor).toBeHidden()
  await expect.poll(titles).toEqual(Array(7).fill('Evening run'))
  await app.close()
})

test('recurring drag: asks the scope; "This event" moves one instance, Cancel moves none', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('view-switch-day').click()
  const starts = async (): Promise<string[]> =>
    (await page.evaluate((r) => window.api.events.list(r), range)).filter((e) => e.recurringEventId === 'run-series').map((e) => e.start).sort()
  const before = await starts()
  const drag = async (): Promise<void> => {
    const run = page.getByTestId('event-block').filter({ hasText: 'Morning run' }).first()
    await run.scrollIntoViewIfNeeded()
    const box = (await run.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 32, { steps: 4 })
    await page.mouse.move(box.x + box.width / 2, box.y + 56, { steps: 4 })
    await page.mouse.up()
  }
  const prompt = page.getByTestId('scope-prompt')

  await drag()
  await expect(prompt).toContainText('Move recurring event')
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'e2e/screens/recurring-drag.png' })
  await prompt.getByRole('button', { name: 'Cancel' }).click()
  await expect(prompt).toBeHidden()
  expect(await starts()).toEqual(before)

  await drag()
  await prompt.getByRole('button', { name: 'This event' }).click()
  await expect(page.getByTestId('toast')).toContainText('Moved “Morning run”')
  await expect.poll(async () => (await starts()).filter((s) => !before.includes(s))).toHaveLength(1)
  await app.close()
})

test('repeat rule: create "every 2 days, 3 times", then make "Morning run" weekly for all events', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 900 })
  const wide = { start: new Date(Date.now() - 864e5 * 30).toISOString(), end: new Date(Date.now() + 864e5 * 90).toISOString() }
  const list = async (title: string): Promise<string[]> =>
    (await page.evaluate((r) => window.api.events.list(r), wide)).filter((e) => e.title === title).map((e) => e.start).sort()

  await page.getByTestId('new-event').click()
  const editor = page.getByTestId('editor')
  await choose(page.getByTestId('editor-account'), 'personal')
  await editor.getByPlaceholder('New Event').fill('Stretch')
  await choose(page.getByTestId('editor-repeat'), 'custom')
  await editor.getByLabel('Repeat every').fill('2')
  await choose(editor.getByLabel('Repeat unit'), 'daily')
  await choose(editor.getByLabel('Repeat stops'), 'count')
  await editor.getByLabel('Occurrences').fill('3')
  await expect(page.getByTestId('editor-repeat')).toHaveText('Every 2 days · 3 times')
  await page.screenshot({ path: 'e2e/screens/repeat-custom.png' })
  await page.getByTestId('editor-save').click()
  await expect(editor).toBeHidden()
  await expect.poll(async () => (await list('Stretch')).length).toBe(3)
  const [a, b] = (await list('Stretch')).map((s) => new Date(s).getTime())
  expect(Math.round((b - a) / 864e5)).toBe(2)

  await page.getByTestId('view-switch-day').click()
  await page.getByTestId('event-block').filter({ hasText: 'Morning run' }).first().click()
  await page.getByTestId('details').getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByTestId('editor-repeat')).toHaveAttribute('data-value', 'daily')
  await expect(editor.getByLabel('Repeat stops')).toHaveAttribute('data-value', 'count')
  await expect(editor.getByLabel('Occurrences')).toHaveValue('7')
  await choose(page.getByTestId('editor-repeat'), 'weekly')
  await page.getByTestId('editor-save').click()
  const scope = editor.getByRole('group', { name: 'Change the repeat rule for' })
  await expect(scope.getByRole('button', { name: 'This event' })).toHaveCount(0)
  await page.screenshot({ path: 'e2e/screens/repeat-scope.png' })
  await scope.getByRole('button', { name: 'All events' }).click()
  await expect(editor).toBeHidden()
  // The 7 daily runs become weekly (still 7 times): one per week from the first one. Rounded: a clock change adds or drops an hour.
  await expect.poll(async () => {
    const runs = (await list('Morning run')).map((s) => new Date(s).getTime())
    return runs.slice(1).map((t, i) => Math.round((t - runs[i]) / 864e5))
  }).toEqual([7, 7, 7, 7, 7, 7])
  await app.close()
})

test('toolbar "+ new" opens the editor; custom picker sets date and time', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('new-event').click()
  const editor = page.getByTestId('editor')
  await expect(editor).toBeVisible()
  await choose(page.getByTestId('editor-account'), 'personal')
  await editor.getByPlaceholder('New Event').fill('Picked')

  await editor.getByRole('button', { name: 'Starts date' }).click()
  const cal = page.getByRole('dialog', { name: 'Starts date' })
  await expect(cal).toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'e2e/screens/picker-date.png' })
  await cal.locator('.rdp-day:not(.rdp-outside) button', { hasText: /^15$/ }).click()
  await expect(cal).toBeHidden()
  await expect(editor.getByRole('button', { name: 'Starts date' })).toContainText(' 15 ')

  await editor.getByRole('button', { name: 'Starts time' }).click()
  const times = page.getByRole('dialog', { name: 'Starts time' })
  await expect(times).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/picker-time.png' })
  await times.getByRole('option', { name: '09:30' }).click()
  await expect(editor.getByRole('button', { name: 'Starts time' })).toHaveText('09:30')

  // Typed off-grid time; Esc closes only the picker, not the editor.
  await editor.getByRole('button', { name: 'Ends time' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Ends time' })).toBeHidden()
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Ends date' })).toContainText(' 15 ')
  await editor.getByRole('button', { name: 'Ends time' }).click()
  await page.getByLabel('Ends time, HH:mm').fill('10:05')
  await page.keyboard.press('Enter')
  await expect(editor.getByRole('button', { name: 'Ends time' })).toHaveText('10:05')
  await page.screenshot({ path: 'e2e/screens/picker-editor.png' })

  await page.getByTestId('editor-save').click()
  await expect(editor).toBeHidden()
  const picked = async () =>
    (await page.evaluate((r) => window.api.events.list(r), { start: '2000-01-01T00:00:00Z', end: '2100-01-01T00:00:00Z' })).find((e) => e.title === 'Picked')
  await expect.poll(picked).toBeTruthy()
  const ev = (await picked())!
  const start = new Date(ev.start)
  const end = new Date(ev.end)
  expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([15, 9, 30])
  expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([15, 10, 5])
  await app.close()
})
