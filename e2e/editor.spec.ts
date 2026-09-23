import { test, expect, _electron as electron } from '@playwright/test'

test('editor requires an explicit account; RSVP goes through the invite account', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  const range = { start: new Date(Date.now() - 864e5 * 30).toISOString(), end: new Date(Date.now() + 864e5 * 90).toISOString() }
  const before = await page.evaluate((r) => window.api.events.list(r), range)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-event'))
  const editor = page.getByTestId('editor')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('editor-account')).toHaveValue('')
  await expect(page.getByTestId('editor-save')).toBeDisabled()

  // Personal only offers its own writable calendar (no read-only Holidays, nothing from work).
  await page.getByTestId('editor-account').selectOption('personal')
  const personalCals = await page.getByTestId('editor-calendar').locator('option:not([disabled])').allTextContents()
  expect(personalCals).toEqual(['Personal'])

  await page.getByTestId('editor-account').selectOption('work')
  await expect(page.getByTestId('editor-calendar')).toHaveValue('work-main')
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
