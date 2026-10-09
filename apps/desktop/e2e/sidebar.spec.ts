import { test, expect, _electron as electron } from '@playwright/test'
import { addDays, addMonths, endOfWeek, format, startOfWeek } from 'date-fns'

test('sidebar collapses and expands, remembers it, and ⌘\\ / Ctrl+\\ toggles it', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  const sidebar = page.getByTestId('sidebar')
  const toggle = page.getByTestId('sidebar-toggle')
  const title = page.locator('.toolbar-title')

  // Expanded by default: the one toggle sits centred on the sidebar's right edge, level with the title.
  await expect(sidebar).toBeVisible()
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const sb = (await sidebar.boundingBox())!
  const tb = (await toggle.boundingBox())!
  const hb = (await title.boundingBox())!
  expect(Math.abs(tb.x + tb.width / 2 - (sb.x + sb.width))).toBeLessThan(2)
  expect(Math.abs(tb.y + tb.height / 2 - (hb.y + hb.height / 2))).toBeLessThan(4)

  await toggle.click()
  await expect(sidebar).toBeHidden()
  // The same toggle stays at the top, now a little in from the left edge, with the title clear of it.
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeLessThan(1)
  await expect.poll(async () => (await toggle.boundingBox())!.x).toBeGreaterThan(0)
  const tc = (await toggle.boundingBox())!
  expect(Math.abs(tc.y - tb.y)).toBeLessThan(1)
  await expect.poll(async () => (await title.boundingBox())!.x).toBeGreaterThan(tc.x + tc.width)
  await page.screenshot({ path: 'e2e/screens/sidebar-collapsed.png' })

  // Survives a reload.
  await page.reload()
  await expect(page.locator('.app-loader')).toBeHidden()
  await expect(sidebar).toBeHidden()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backslash' : 'Control+Backslash')
  await expect(sidebar).toBeVisible()
  await expect.poll(async () => (await page.locator('.main').boundingBox())!.x).toBeGreaterThan(200)

  // One toggle both hides and shows it.
  await toggle.click()
  await expect(sidebar).toBeHidden()
  await toggle.click()
  await expect(sidebar).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await app.close()
})

test('mini-month is one labelled tab stop, arrow keys move within it, and it tints the visible days', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(page.locator('.app-loader')).toBeHidden()
  const label = (d: Date): string => format(d, 'EEEE, d MMMM yyyy')
  const today = new Date()
  const title = page.locator('.toolbar-title')
  const stop = page.locator('.mini-day[tabindex="0"]')
  const focused = page.locator('.mini-day:focus')

  // Week view: today is the one tab stop, current and selected; the visible week is tinted.
  await expect(stop).toHaveCount(1)
  await expect(page.locator('.mini-day:not([tabindex="-1"])')).toHaveCount(1)
  await expect(stop).toHaveAttribute('aria-label', label(today))
  await expect(stop).toHaveAttribute('aria-current', 'date')
  await expect(stop).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.mini-day.in-range')).toHaveCount(7)
  await page.locator('.mini').screenshot({ path: 'e2e/screens/mini-month.png' })

  // Arrows move the focus a day / a week without stepping the main view.
  const week = await title.textContent()
  await stop.focus()
  await page.keyboard.press('ArrowRight')
  await expect(focused).toHaveAttribute('aria-label', label(addDays(today, 1)))
  await expect(title).toHaveText(week!)
  await page.keyboard.press('ArrowDown')
  await expect(focused).toHaveAttribute('aria-label', label(addDays(today, 8)))
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowLeft')
  await expect(focused).toHaveAttribute('aria-label', label(today))
  await expect(title).toHaveText(week!)
  await expect(stop).toHaveCount(1)

  // Home / End: start and end of the week; PageDown: a month on, and the shown month follows.
  await page.keyboard.press('Home')
  await expect(focused).toHaveAttribute('aria-label', label(startOfWeek(today, { weekStartsOn: 1 })))
  await page.keyboard.press('End')
  const end = endOfWeek(today, { weekStartsOn: 1 })
  await expect(focused).toHaveAttribute('aria-label', label(end))
  await page.keyboard.press('PageDown')
  const target = addMonths(end, 1)
  await expect(focused).toHaveAttribute('aria-label', label(target))
  await expect(page.locator('.mini-title')).toHaveText(format(target, 'LLLL yyyy'))

  // Enter selects it: the main view moves there and the tint follows.
  await page.keyboard.press('Enter')
  await expect(focused).toHaveAttribute('aria-pressed', 'true')
  await expect(title).not.toHaveText(week!)
  await expect(page.locator('.mini-day.in-range')).toHaveCount(7)
  await expect(page.locator(`.mini-day.in-range[aria-label="${label(target)}"]`)).toHaveCount(1)

  // t (a window shortcut) moves the main view back to today; focus follows instead of dropping to <body>.
  await page.keyboard.press('t')
  await expect(focused).toHaveAttribute('aria-label', label(today))
  await expect(title).toHaveText(week!)

  await page.getByTestId('view-switch-3day').click()
  await expect(page.locator('.mini-day.in-range')).toHaveCount(3)
  await page.getByTestId('view-switch-day').click()
  await expect(page.locator('.mini-day.in-range')).toHaveCount(1)
  await page.getByTestId('view-switch-month').click()
  await expect(page.locator('.mini-day.in-range')).toHaveCount(0)
  await app.close()
})
