import { test, expect, _electron as electron } from '@playwright/test'
import { choose, optionLabels } from './choose'

type Shown = { title: string; body: string; actions: { text: string }[] }

test('reminders: Settings choice and a banner with a join button before the event', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  // Record banners instead of showing them (CI has no notification server).
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as { shown: unknown[] }
    g.shown = []
    Notification.isSupported = () => true
    Notification.prototype.show = function (this: Electron.Notification) {
      g.shown.push({ title: this.title, body: this.body, actions: this.actions.map((a) => ({ text: a.text })) })
    }
  })
  const shown = (): Promise<Shown[]> => app.evaluate(() => (globalThis as unknown as { shown: Shown[] }).shown)

  // A call in 4 minutes whose Teams link is only in the HTML description.
  await page.evaluate(async () => {
    const at = (min: number): string => new Date(Date.now() + min * 60_000).toISOString()
    const base = { accountId: 'work', calendarId: 'work-main', allDay: false, start: at(4), end: at(34) }
    await window.api.events.create({ ...base, title: 'Design review', location: 'Room 5', description: '<p>Join: <a href="https://teams.microsoft.com/l/meetup-join/42">Click here</a></p>' })
  })

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-notifications').click()
  const select = page.getByTestId('reminder-select')
  await expect(select).toContainText('2 min before')
  expect(await optionLabels(select)).toEqual(['Off', '1 min before', '2 min before', '5 min before', '10 min before', '15 min before'])
  // Default (2 min) is too short for an event 4 minutes away.
  await page.waitForTimeout(500)
  expect(await shown()).toEqual([])

  await choose(select, '5')
  await expect.poll(shown).toEqual([
    { title: 'Design review', body: expect.stringMatching(/^in [45] min · \d\d:\d\d–\d\d:\d\d · Room 5$/), actions: [{ text: 'Join Teams' }] }
  ])
  // Once per event: changing the setting again does not repeat it.
  await choose(select, '10')
  await page.waitForTimeout(500)
  expect(await shown()).toHaveLength(1)

  // The choice is kept.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-notifications').click()
  await expect(page.getByTestId('reminder-select')).toContainText('10 min before')
  await page.screenshot({ path: 'e2e/screens/settings-notifications.png' })

  await choose(page.getByTestId('reminder-select'), '0')
  await expect(page.getByTestId('reminder-select')).toContainText('Off')
  await app.close()
})

test('reminders: a switched-off account stays silent, the others still notify', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as { shown: unknown[] }
    g.shown = []
    Notification.isSupported = () => true
    Notification.prototype.show = function (this: Electron.Notification) {
      g.shown.push(this.title)
    }
  })
  const shown = (): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { shown: string[] }).shown)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-notifications').click()
  const work = page.getByTestId('notify-account-work')
  await expect(work).toBeChecked()
  await work.uncheck()
  await expect(work).not.toBeChecked()
  await page.screenshot({ path: 'e2e/screens/settings-notifications-accounts.png' })

  await page.evaluate(async () => {
    const at = (min: number): string => new Date(Date.now() + min * 60_000).toISOString()
    await window.api.events.create({ accountId: 'work', calendarId: 'work-main', allDay: false, start: at(1), end: at(30), title: 'Muted call' })
  })
  await choose(page.getByTestId('reminder-select'), '5')
  await page.waitForTimeout(500)
  expect(await shown()).not.toContain('Muted call')

  // Back on: the next tick picks the event up.
  await work.check()
  await choose(page.getByTestId('reminder-select'), '10')
  await expect.poll(shown).toContain('Muted call')
  await choose(page.getByTestId('reminder-select'), '2')
  await app.close()
})
