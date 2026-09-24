import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'

test('offers a newer GitHub release and downloads it', async () => {
  // A real zip holding a dummy bundle, like the release asset.
  const dir = mkdtempSync(join(tmpdir(), 'mysticals-e2e-update-'))
  mkdirSync(join(dir, 'Mysticals.app/Contents/MacOS'), { recursive: true })
  execFileSync('ditto', ['-c', '-k', '--keepParent', join(dir, 'Mysticals.app'), join(dir, 'app.zip')])
  const zip = readFileSync(join(dir, 'app.zip'))

  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    if (req.url === '/latest') {
      res.setHeader('content-type', 'application/json')
      const name = `Mysticals-99.0.0-${process.arch}-mac.zip`
      return res.end(JSON.stringify({ tag_name: 'v99.0.0', assets: [{ name, browser_download_url: `${base}/${name}` }] }))
    }
    res.setHeader('content-length', zip.length)
    res.end(zip)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const feed = `http://127.0.0.1:${(server.address() as AddressInfo).port}/latest`

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, MYSTICALS_MOCK: '1', MYSTICALS_UPDATE_FEED: feed }
  })
  const page = await app.firstWindow()
  await expect(page.getByTestId('calendar-view')).toBeVisible()
  const item = page.getByTestId('sbar-update')
  await expect(item).toHaveText('↑ Update to 99.0.0')
  await expect(page.locator('.app-loader')).toBeHidden()
  await page.screenshot({ path: 'e2e/screens/update.png' })

  await item.click()
  await expect(item).toHaveText('Restarting…')
  await app.close()
  server.close()
})
