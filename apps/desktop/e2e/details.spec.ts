import { test, expect, _electron as electron } from '@playwright/test'

test('event details: location link, collapsible invitees, RSVP colors', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })

  // Sprint planning is tomorrow, outside the week view on a Sunday: go to its day.
  await page.getByTestId('view-switch-day').click()
  await page.keyboard.press('ArrowRight')
  await page.getByTestId('event-block').filter({ hasText: 'Sprint planning' }).first().click()
  const details = page.getByTestId('details')
  await expect(details).toBeVisible()

  // The location's link is a call button; the row keeps only the place.
  const link = details.locator('a.details-linkbtn')
  await expect(link).toHaveAttribute('href', 'https://meet.example.com/sprint-planning')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('data-kind', 'video')
  await expect(link).toHaveText('Join call · meet.example.com')
  await expect(details.locator('.details-row').first()).toHaveText(/Location\s*Room 3$/)

  const toggle = page.getByTestId('invitees-toggle')
  await expect(toggle).toHaveText('▸ Invitees (2)')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(details.locator('.details-people')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(details.locator('.details-people li')).toHaveCount(2)

  // Selected reply takes its status color, not the calendar accent.
  const token = (name: string): Promise<string> =>
    page.evaluate((n) => {
      const d = document.createElement('div')
      d.style.color = `var(${n})`
      document.body.appendChild(d)
      const v = getComputedStyle(d).color
      d.remove()
      return v
    }, name)
  // The calendar colour (Work, #8be9fd) marks the dot only; the call link keeps the theme accent so it stays legible.
  await expect(details.locator('.details-dot')).toHaveCSS('background-color', 'rgb(139, 233, 253)')
  await expect(link).toHaveCSS('color', await token('--accent'))
  for (const [status, name] of [['declined', '--red'], ['tentative', '--orange'], ['accepted', '--green']]) {
    const btn = page.getByTestId(`rsvp-${status}`)
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(await btn.evaluate((el) => getComputedStyle(el).color)).toBe(await token(name))
  }

  await page.waitForTimeout(300) // let the popover fade-in finish
  await page.screenshot({ path: 'e2e/screens/details.png' })
  await app.close()
})

test('event details: Meet from conference data, map and self-hosted call buttons', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByTestId('view-switch-day').click()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight') // the mock puts these five days ahead
  const details = page.getByTestId('details')
  const block = (title: string) => page.getByTestId('event-block').filter({ hasText: title }).first()

  // Google keeps this Meet in hangoutLink/conferenceData, not in the location.
  await block('Ukraine - Portugal').click()
  const meet = details.locator('a.details-linkbtn')
  await expect(meet).toHaveCount(1)
  await expect(meet).toHaveAttribute('href', 'https://meet.google.com/zon-fdwf-hnk')
  await expect(meet).toHaveAttribute('data-kind', 'meet')
  await expect(meet).toHaveText('Join Google Meet')
  await expect(details.getByText('Location')).toHaveCount(0)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e/screens/details-meet.png' })
  await page.keyboard.press('Escape')

  await block('Coffee').click()
  await expect(details.locator('a.details-linkbtn')).toHaveAttribute('data-kind', 'map')
  await expect(details.locator('.details-row').first()).toHaveText(/Location\s*Podil$/)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e/screens/details-map.png' })
  await page.keyboard.press('Escape')

  await block('Catch-up').click()
  await expect(details.locator('a.details-linkbtn')).toHaveAttribute('data-kind', 'video')
  await expect(details.locator('a.details-linkbtn')).toHaveText('Join call · meet.namechip.net')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e/screens/details-video.png' })
  await app.close()
})

test('event details: a long invitee list scrolls in a capped box', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  await page.evaluate(async () => {
    const d = new Date()
    const at = (h: number): string => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString()
    await window.api.events.create({
      accountId: 'work', calendarId: 'work-main', allDay: false, start: at(13), end: at(14), title: 'All hands',
      attendees: Array.from({ length: 24 }, (_, i) => `person${i}@work.example`)
    })
  })

  await page.getByTestId('event-block').filter({ hasText: 'All hands' }).first().click()
  await page.getByTestId('invitees-toggle').click()
  const people = page.getByTestId('details').locator('.details-people')
  await expect(people.locator('li')).toHaveCount(24)
  expect((await people.boundingBox())!.height).toBeLessThanOrEqual(180)
  expect(await people.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'e2e/screens/details-many-invitees.png' })
  await app.close()
})
