import { test, expect, _electron as electron } from '@playwright/test'

test('event blocks and details popover have square terminal borders', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MULTICALS_MOCK: '1' } })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  const block = page.getByTestId('event-block').filter({ hasText: 'Daily standup' }).first()
  await expect(block).toBeVisible()
  await expect(block).toHaveCSS('border-radius', '0px')
  await page.screenshot({ path: 'e2e/screens/borders-week.png' })

  await block.click()
  const details = page.getByTestId('details')
  await expect(details).toBeVisible()
  await expect(details).toHaveCSS('border-radius', '0px')
  await page.screenshot({ path: 'e2e/screens/borders-details.png' })
  await app.close()
})
