import { test, expect, _electron as electron } from '@playwright/test'

test('settings logs list a change and an RSVP with their details', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MYSTICALS_MOCK: '1' } })
  const page = await app.firstWindow()

  // Answer the seeded invite and rename the account through the same API the UI uses.
  await page.evaluate(async () => {
    const day = new Date()
    const range = { start: new Date(day.getTime() - 7 * 864e5).toISOString(), end: new Date(day.getTime() + 14 * 864e5).toISOString() }
    const invite = (await window.api.events.list(range)).find((e) => e.title === 'Sprint planning')!
    await window.api.events.respond(invite, 'accepted')
    await window.api.accounts.update('work', { label: 'Acme' })
  })

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByTestId('settings-tab-logs').click()
  const rows = page.getByTestId('log-entry')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Account edited')
  await expect(rows.nth(1)).toContainText('Invite answered')
  await expect(rows.nth(1)).toContainText('Sprint planning')

  await rows.nth(1).click()
  const details = page.getByTestId('log-details')
  await expect(details).toContainText('me@work.example')
  await expect(details).toContainText('pm@work.example')
  await expect(details).toContainText('accepted')

  await page.getByTestId('log-account-personal').click()
  await expect(page.getByTestId('log-list')).not.toContainText('Sprint planning')
  await page.getByTestId('log-account-work').click()
  await expect(rows).toHaveCount(2)
  await page.screenshot({ path: 'e2e/screens/logs.png' })
  await app.close()
})
