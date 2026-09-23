import { test, expect, _electron as electron } from '@playwright/test'

test('event details: location link, collapsible invitees, RSVP colors', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })

  await page.getByTestId('event-block').filter({ hasText: 'Sprint planning' }).first().click()
  const details = page.getByTestId('details')
  await expect(details).toBeVisible()

  const link = details.locator('a.details-link')
  await expect(link).toHaveAttribute('href', 'https://meet.example.com/sprint-planning')
  await expect(link).toHaveAttribute('target', '_blank')

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
