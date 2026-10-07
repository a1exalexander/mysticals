import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { choose } from './choose'

test('full-screen reminder: call events open the reminder window instead of a banner, Esc closes it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ Notification, shell }) => {
    const g = globalThis as unknown as { shown: string[]; opened: string[] }
    g.shown = []
    g.opened = []
    Notification.isSupported = () => true
    Notification.prototype.show = function (this: Electron.Notification) {
      g.shown.push(this.title)
    }
    shell.openExternal = async (url: string) => void g.opened.push(url)
  })
  const shown = (): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { shown: string[] }).shown)
  const opened = (): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)
  const create = (titles: [string, string], min: number): Promise<void> =>
    page.evaluate(
      async ({ titles, min }) => {
        const at = (m: number): string => new Date(Date.now() + m * 60_000).toISOString()
        await window.api.events.create({ accountId: 'work', calendarId: 'work-main', allDay: false, start: at(min), end: at(min + 30), title: titles[0], location: 'https://zoom.us/j/123456' })
        await window.api.events.create({ accountId: 'personal', calendarId: 'p-main', allDay: false, start: at(min + 1), end: at(min + 25), title: titles[1], location: 'https://meet.google.com/abc-defg-hij' })
        await window.api.events.create({ accountId: 'work', calendarId: 'work-main', allDay: false, start: at(min), end: at(min + 15), title: `${titles[0]} prep`, location: 'Room 5' })
      },
      { titles, min }
    )

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-accounts').click()
  const toggle = page.getByTestId('fullscreen-reminder-toggle')
  await expect(toggle).not.toBeChecked()
  await toggle.check()

  await create(['Standup', 'Design review'], 3)
  const opening = app.waitForEvent('window')
  await choose(page.getByTestId('reminder-select'), '5')
  const screen: Page = await opening
  await expect(screen.getByRole('heading', { name: 'Standup' })).toBeVisible()
  await expect(screen.getByRole('heading', { name: 'Design review' })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Join Zoom' })).toBeVisible()
  await expect(screen.getByRole('textbox').first()).toHaveValue('https://zoom.us/j/123456')
  // The plain event still gets a banner; the calls don't.
  await expect.poll(shown).toEqual(['Standup prep'])

  // Keys meant for another app in the first second are ignored.
  await screen.keyboard.press('Escape')
  await screen.waitForTimeout(300)
  expect(screen.isClosed()).toBe(false)
  await screen.waitForTimeout(900)
  await screen.screenshot({ path: 'e2e/screens/fullscreen-reminder-dark.png' })
  // keydown closes it, so the keyup has no page left: don't wait for a full press.
  await Promise.all([screen.waitForEvent('close'), screen.keyboard.down('Escape').catch(() => {})])

  // Dismissed meetings count as reminded: no banner, no second screen on the next tick.
  await choose(page.getByTestId('reminder-select'), '10')
  await page.waitForTimeout(500)
  expect(app.windows()).toHaveLength(1)
  expect(await shown()).toEqual(['Standup prep'])

  // The next due meetings open a new screen, in the current theme; Join opens the link and closes it.
  await page.evaluate(() => localStorage.setItem('mysticals-theme', 'light'))
  await create(['Retro', 'Planning'], 4)
  const reopening = app.waitForEvent('window')
  await choose(page.getByTestId('reminder-select'), '5')
  const light = await reopening
  await expect(light.getByRole('heading', { name: 'Retro' })).toBeVisible()
  await expect(light.locator('html')).toHaveAttribute('data-theme', 'light')
  await light.waitForTimeout(1100)
  await light.screenshot({ path: 'e2e/screens/fullscreen-reminder-light.png' })
  await Promise.all([light.waitForEvent('close'), light.getByRole('button', { name: 'Join Google Meet' }).click().catch(() => {})])
  expect(await opened()).toEqual(['https://meet.google.com/abc-defg-hij'])

  await page.evaluate(() => localStorage.setItem('mysticals-theme', 'dracula'))
  await toggle.uncheck()
  await choose(page.getByTestId('reminder-select'), '2')
  await app.close()
})
