import { readFileSync } from 'fs'
import { join } from 'path'
import { test, expect, _electron as electron, type Page } from '@playwright/test'

// THEMES[].events in theme.ts, read as text: the module pulls in the renderer's i18n.
const src = readFileSync(join(__dirname, '../src/renderer/src/theme.ts'), 'utf8')
const palette = (id: string): string[] =>
  src.match(new RegExp(`id: '${id}'[^\\n]*\\n\\s*events: \\[([^\\]]*)\\]`))![1].match(/#[\da-f]{6}/g)!

const colours = (page: Page): Promise<string[]> =>
  page.getByTestId('event-block').evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue('--c')))

test('theme event palette: events redraw in the theme palette, pickers split, off restores calendar colours', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.evaluate(() => {
    localStorage.setItem('mysticals-theme', 'dracula')
    localStorage.removeItem('mysticals-event-palette')
    localStorage.removeItem('mysticals-event-fill')
  })
  await page.reload()
  await expect(page.locator('.app-loader')).toBeHidden()
  await expect(page.getByTestId('event-block').first()).toBeVisible()
  const original = await colours(page)
  expect(original.length).toBeGreaterThan(0)

  // Off by default; Settings › Themes turns it on.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-themes').click()
  await expect(page.getByTestId('event-palette-calendar')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('event-palette-theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'theme')
  await page.keyboard.press('Escape')

  // Soft and Solid fills both take the palette.
  for (const [id, fill] of [['dracula', 'opacity'], ['bubble', 'opacity'], ['bubble', 'fill'], ['matrix', 'opacity']]) {
    if (id !== 'dracula') {
      await page.evaluate(([id, fill]) => {
        localStorage.setItem('mysticals-theme', id)
        localStorage.setItem('mysticals-event-fill', fill)
      }, [id, fill])
      await page.reload()
      await expect(page.locator('.app-loader')).toBeHidden()
      await expect(page.locator('html')).toHaveAttribute('data-palette', 'theme')
    }
    await expect.poll(async () => (await colours(page)).every((c) => palette(id).includes(c))).toBe(true)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `e2e/screens/event-palette-${id}-${fill}.png` })
  }

  // Pickers: each swatch split, the theme's colour on top, the original below (Gym is writable, so it can be recoloured).
  await page.getByTestId('event-block').filter({ hasText: 'Gym' }).first().click({ button: 'right' })
  await expect(page.getByTestId('event-menu')).toBeVisible()
  const swatches = page.getByTestId('event-colors').locator('.ev-swatch')
  await expect(swatches).toHaveCount(12)
  for (const sw of await swatches.all()) await expect(sw).toHaveClass(/\bsplit\b/)
  const banana = page.getByTestId('event-colors').locator('[data-color="5"]')
  expect(await banana.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/^linear-gradient/)
  expect(await banana.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--sw'))).toBe('#f6bf26')
  expect(await banana.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--sw-th'))).toBe(palette('matrix')[4])
  const ring = page.getByTestId('event-colors').locator('[data-color="calendar"]')
  expect(await ring.evaluate((el) => getComputedStyle(el, '::before').backgroundImage)).toMatch(/^linear-gradient/)
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'e2e/screens/event-palette-picker.png' })
  await page.keyboard.press('Escape')

  // Off again: the calendar colours come back as they were.
  await page.evaluate(() => {
    localStorage.setItem('mysticals-theme', 'dracula')
    localStorage.setItem('mysticals-event-palette', 'calendar')
    localStorage.removeItem('mysticals-event-fill')
  })
  await page.reload()
  await expect(page.locator('.app-loader')).toBeHidden()
  await expect.poll(() => colours(page)).toEqual(original)
  await expect(page.getByTestId('event-colors')).toHaveCount(0)

  await page.evaluate(() => {
    localStorage.removeItem('mysticals-theme')
    localStorage.removeItem('mysticals-event-palette')
    localStorage.removeItem('mysticals-event-fill')
  })
  await app.close()
})
