import { test, expect, _electron as electron, type Page } from '@playwright/test'

const gymStart = (page: Page, title = 'Gym'): Promise<{ start: string; end: string }> =>
  page.evaluate(async (title) => {
    const d = new Date()
    const all = await window.api.events.list({
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7).toISOString(),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).toISOString()
    })
    const gym = all.find((e) => e.title === title)!
    return { start: gym.start, end: gym.end }
  }, title)
const hour = (iso: string): string => new Date(iso).toTimeString().slice(0, 5)

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 })
  await page.mouse.up()
}

test('drag an event to move and resize it, undo, and move by day in the month', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('view-switch-day').click()

  const gym = page.getByTestId('event-block').filter({ hasText: 'Gym' })
  await gym.scrollIntoViewIfNeeded()
  let box = (await gym.boundingBox())!
  // Move one hour later (48px per hour).
  await drag(page, { x: box.x + box.width / 2, y: box.y + 10 }, 0, 48)
  await expect(page.getByTestId('toast')).toContainText('Moved “Gym”')
  await expect.poll(async () => hour((await gymStart(page)).start)).toBe('20:00')
  await expect(page.getByTestId('details')).toHaveCount(0) // a drag is not a click

  // Undo puts it back.
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => hour((await gymStart(page)).start)).toBe('19:00')

  // Drag the bottom edge: ends an hour later.
  await gym.scrollIntoViewIfNeeded()
  box = (await gym.boundingBox())!
  await gym.hover()
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height - 2 }, 0, 48)
  await expect.poll(async () => hour((await gymStart(page)).end)).toBe('21:00')
  expect(hour((await gymStart(page)).start)).toBe('19:00')

  // Escape cancels a drag.
  box = (await gym.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 150, { steps: 5 })
  await expect(page.getByTestId('drag-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.getByTestId('drag-preview')).toHaveCount(0)
  expect(hour((await gymStart(page)).start)).toBe('19:00')

  // Month: drop on the next day keeps the time (Dinner is two days ahead; today's cell folds into "+N more").
  const dinner = (): Promise<{ start: string; end: string }> => gymStart(page, 'Dinner with friends')
  const before = new Date((await dinner()).start)
  await page.getByTestId('view-switch-month').click()
  const chip = page.getByTestId('event-block').filter({ hasText: 'Dinner with friends' })
  const cell = chip.locator('xpath=ancestor::div[contains(@class,"mg-cell")]')
  const idx = Number(await cell.getAttribute('data-idx'))
  const target = page.locator(`.mg-cell[data-idx="${idx % 7 === 6 ? idx - 1 : idx + 1}"]`)
  const c = (await chip.boundingBox())!
  const t = (await target.boundingBox())!
  await drag(page, { x: c.x + 10, y: c.y + c.height / 2 }, t.x + t.width / 2 - (c.x + 10), t.y + t.height / 2 - (c.y + c.height / 2))
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  await expect
    .poll(async () => Math.round((day(new Date((await dinner()).start)) - day(before)) / 86_400_000))
    .toBe(idx % 7 === 6 ? -1 : 1)
  expect(hour((await dinner()).start)).toBe('20:00')
  await app.close()
})

test('read-only events do not drag', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('view-switch-day').click()
  // Standup is an invite (organized by someone else): it opens, it doesn't move.
  const standup = page.getByTestId('event-block').filter({ hasText: 'Daily standup' })
  await standup.scrollIntoViewIfNeeded()
  const box = (await standup.boundingBox())!
  await drag(page, { x: box.x + box.width / 2, y: box.y + 5 }, 0, 96)
  await expect(page.getByTestId('drag-preview')).toHaveCount(0)
  await expect(page.getByTestId('toast')).toHaveCount(0)
  await app.close()
})
