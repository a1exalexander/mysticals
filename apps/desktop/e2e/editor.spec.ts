import { test, expect, _electron as electron } from '@playwright/test'
import { choose, optionLabels } from './choose'
import { stackDialog } from './stackDialog'

test('editor requires an explicit account; RSVP goes through the invite account', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  const range = { start: new Date(Date.now() - 864e5 * 30).toISOString(), end: new Date(Date.now() + 864e5 * 90).toISOString() }
  const before = await page.evaluate((r) => window.api.events.list(r), range)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-event'))
  const editor = page.getByTestId('editor')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('editor-account')).toHaveAttribute('data-value', '')
  await expect(page.getByTestId('editor-save')).toBeDisabled()

  // Personal only offers its own writable calendar (no read-only Holidays, nothing from work).
  await choose(page.getByTestId('editor-account'), 'personal')
  const personalCals = await optionLabels(page.getByTestId('editor-calendar'))
  expect(personalCals).toEqual(['Personal'])

  await choose(page.getByTestId('editor-account'), 'work')
  await expect(page.getByTestId('editor-calendar')).toHaveAttribute('data-value', 'work-main')
  await expect(page.getByTestId('editor-save')).toBeEnabled()
  await editor.getByPlaceholder('New Event').fill('Unit7 review')
  await editor.getByPlaceholder('Add location').fill('Room 5')
  await expect(editor).toContainText('Created in Work · me@work.example')
  await page.screenshot({ path: 'e2e/screens/unit7-editor.png' })
  await page.getByTestId('editor-save').click()
  await expect(editor).toBeHidden()

  const list = (): Promise<Awaited<ReturnType<typeof window.api.events.list>>> =>
    page.evaluate((r) => window.api.events.list(r), range)
  await expect.poll(async () => (await list()).filter((e) => e.title === 'Unit7 review').length).toBe(1)
  const after = await list()
  const created = after.filter((e) => e.title === 'Unit7 review')
  expect(created[0]).toMatchObject({ accountId: 'work', calendarId: 'work-main', attendees: [] })
  const count = (list: typeof after, id: string): number => list.filter((e) => e.accountId === id).length
  expect(count(after, 'personal')).toBe(count(before, 'personal'))

  // Invites panel -> details -> Accept.
  await expect(page.getByTestId('invites-button')).toContainText('1')
  await page.getByTestId('invites-button').click()
  await page.locator('.invites-name', { hasText: 'Sprint planning' }).click()
  const details = page.getByTestId('details')
  await expect(details).toBeVisible()
  await expect(details).toContainText('Reply as me@work.example')
  await expect(details.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await page.getByTestId('rsvp-accepted').click()
  await expect(page.getByTestId('rsvp-accepted')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(300) // let the popover fade-in finish
  await page.screenshot({ path: 'e2e/screens/unit7-details.png' })

  const sprint = (await page.evaluate((r) => window.api.events.list(r), range)).find((e) => e.title === 'Sprint planning')
  expect(sprint).toMatchObject({ accountId: 'work', myStatus: 'accepted' })
  await app.close()
})

test('switches on light themes: off is a white knob on a pale track, not the ink that reads as on', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  // Off track is --fg 14% into the white --surface-2 (visible on white popovers), checked track --accent;
  // Cartoon's ink --line-strong track used to read as on.
  const themes = [
    { id: 'light', off: 'color(srgb 0.869333 0.869333 0.869333)', on: 'rgb(17, 17, 17)' },
    { id: 'toon', off: 'color(srgb 0.883608 0.878118 0.895137)', on: 'rgb(123, 63, 242)' }
  ]
  for (const { id, off, on } of themes) {
    await page.evaluate((id) => localStorage.setItem('mysticals-theme', id), id)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-scheme', 'light')
    await expect(page.getByTestId('calendar-view')).toBeVisible()

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-event'))
    const allDay = page.getByTestId('editor').getByRole('switch', { name: 'All-day' })
    await expect(allDay).not.toBeChecked()
    const knob = (): Promise<string> => allDay.evaluate((el) => getComputedStyle(el, '::after').backgroundColor)
    const track = (): Promise<string> => allDay.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await knob()).toBe('rgb(255, 255, 255)')
    await expect.poll(track).toBe(off)
    // Checked stays as it was: the --on-accent knob on the accent track.
    await allDay.click()
    await expect(allDay).toBeChecked()
    expect(await knob()).toBe('rgb(255, 255, 255)')
    await expect.poll(track).toBe(on)
  }

  await page.evaluate(() => localStorage.removeItem('mysticals-theme'))
  await app.close()
})

test('editor fields are named by their labels, a label click focuses its field, the title shows focus', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  await page.getByTestId('new-event').click()
  const editor = page.getByTestId('editor')

  const title = editor.getByRole('textbox', { name: 'Title' })
  await expect(title).toBeFocused()
  await expect(title).not.toHaveCSS('box-shadow', 'none')
  for (const name of ['Location', 'Invitees', 'Notes']) {
    await editor.locator('label', { hasText: name }).click()
    await expect(editor.getByLabel(name, { exact: true })).toBeFocused()
  }
  await editor.getByLabel('Location', { exact: true }).fill('Room 5')
  await expect(editor.getByPlaceholder('Add location')).toHaveValue('Room 5')
  await editor.locator('label', { hasText: 'All-day' }).click()
  await expect(editor.getByRole('switch', { name: 'All-day' })).toBeChecked()
  // The repeat rows too: each label points at its (first) control.
  await choose(page.getByTestId('editor-repeat'), 'custom')
  await choose(editor.getByLabel('Repeat stops'), 'count')
  const control = (text: string): Promise<string | null | undefined> =>
    editor.locator('.editor-grid > label', { hasText: new RegExp(`^${text}$`) }).evaluate((l: HTMLLabelElement) => l.control?.getAttribute('aria-label'))
  expect(await control('Repeat')).toBe('Repeat')
  expect(await control('Every')).toBe('Repeat every')
  expect(await control('Stops')).toBe('Repeat stops')
  // A picker's label opens it, like a click on its trigger.
  await editor.locator('label', { hasText: 'Starts' }).click()
  await expect(page.getByRole('dialog', { name: 'Starts date' })).toBeVisible()
  await page.screenshot({ path: 'e2e/screens/editor-labels.png' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await editor.getByRole('group', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard' }).click()

  // Editing shows the account and calendar as text: no label points at a missing control.
  await page.getByTestId('event-block').filter({ hasText: 'Gym' }).first().click()
  await page.getByTestId('details').getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByTestId('editor-account')).toBeVisible()
  expect(await editor.locator('label[for]').evaluateAll((ls) => ls.filter((l) => !(l as HTMLLabelElement).control).map((l) => l.textContent))).toEqual([])
  await app.close()
})

test('Esc or a click outside asks before discarding changes; an untouched editor just closes', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  const editor = page.getByTestId('editor')
  const title = editor.getByRole('textbox', { name: 'Title' })
  const discard = editor.getByRole('group', { name: 'Discard changes?' })

  await page.getByTestId('new-event').click()
  await expect(title).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)

  await page.getByTestId('new-event').click()
  await title.fill('Half-written')
  await page.keyboard.press('Escape')
  await expect(discard).toBeVisible()
  await expect(discard.getByRole('button', { name: 'Keep editing' })).toBeFocused()
  await expect(page.getByTestId('editor-save')).toHaveCount(0)
  await page.waitForTimeout(250) // let the sheet's drop-in finish
  await page.screenshot({ path: 'e2e/screens/editor-discard.png' })
  // Esc again keeps editing.
  await page.keyboard.press('Escape')
  await expect(discard).toHaveCount(0)
  await expect(title).toHaveValue('Half-written')
  await expect(title).toBeFocused()

  // A click on the backdrop asks too; an invitee still being typed counts as a change.
  await title.fill('')
  await editor.getByLabel('Invitees', { exact: true }).fill('bob@example.com')
  await page.mouse.click(100, 600)
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Keep editing' }).click()
  await expect(discard).toHaveCount(0)
  await page.keyboard.press('Escape')
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(editor).toHaveCount(0)

  // Editing without a change: the series' rule loading in isn't one.
  await page.getByTestId('view-switch-day').click()
  await page.getByTestId('event-block').filter({ hasText: 'Morning run' }).first().click()
  await page.getByTestId('details').getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByTestId('editor-repeat')).toHaveAttribute('data-value', 'daily')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await app.close()
})

test('Esc and Cmd+Enter in a dialog stacked on the editor stay with that dialog', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  await page.getByTestId('new-event').click()
  const editor = page.getByTestId('editor')
  await choose(page.getByTestId('editor-account'), 'personal')
  await editor.getByRole('textbox', { name: 'Title' }).fill('Not yet')

  await page.evaluate(stackDialog)
  await expect(page.getByLabel('On top')).toBeFocused()
  await page.keyboard.press('Control+Enter')
  await page.keyboard.press('Escape')
  await expect(page.locator('#on-top')).not.toHaveAttribute('open')
  await expect(editor.getByRole('group', { name: 'Discard changes?' })).toHaveCount(0)
  await expect(page.getByTestId('editor-save')).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Title' })).toHaveValue('Not yet')
  await app.close()
})

test('the menu\'s New Event asks before replacing a changed editor; Cmd+Enter at the prompt saves, Discard opens it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  const menuNew = (): Promise<void> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-event'))
  const editor = page.getByTestId('editor')
  const title = editor.getByRole('textbox', { name: 'Title' })
  const discard = editor.getByRole('group', { name: 'Discard changes?' })

  // Untouched: replaced at once.
  await page.getByTestId('new-event').click()
  await expect(title).toBeFocused()
  await menuNew()
  await expect(title).toBeFocused()
  await expect(discard).toHaveCount(0)

  await choose(page.getByTestId('editor-account'), 'personal')
  await title.fill('Keep me')
  await menuNew()
  await expect(discard).toBeVisible()
  await expect(title).toHaveValue('Keep me')
  await page.keyboard.press('Control+Enter')
  await expect(editor).toHaveCount(0)
  const all = { start: '2000-01-01T00:00:00Z', end: '2100-01-01T00:00:00Z' }
  await expect.poll(async () => (await page.evaluate((r) => window.api.events.list(r), all)).filter((e) => e.title === 'Keep me').length).toBe(1)

  // Discard drops the changes and opens the new event that was asked for.
  await page.getByTestId('new-event').click()
  await title.fill('Drop me')
  await menuNew()
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(discard).toHaveCount(0)
  await expect(title).toHaveValue('')
  await expect(title).toBeFocused()
  await app.close()
})
