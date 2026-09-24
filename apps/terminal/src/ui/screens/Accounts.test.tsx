import { afterEach, describe, expect, it } from 'vitest'
import { KEY, renderApp, renderWith, type Rendered } from '../../test/harness'
import { Accounts } from './Accounts'

let t: Rendered
afterEach(() => t?.unmount())

const open = async (): Promise<void> => {
  t = renderApp()
  await t.waitFor('Gym')
  await t.press('s')
  await t.waitFor('Holidays')
}

describe('Accounts overlay', () => {
  it('lists accounts with their calendars and closes on esc', async () => {
    await open()
    const f = t.lastFrame()!
    expect(f).toContain('me@work.example · CalDAV')
    expect(f).toContain('me@gmail.example · Google')
    expect(f).toContain('(read-only)')
    await t.press('w') // overlay owns input: not a view switch
    expect(t.lastFrame()).toContain('Accounts & calendars')
    await t.press(KEY.esc)
    await t.waitFor('Gym')
  })

  it('toggles a calendar with space using its own account', async () => {
    await open()
    // rows: Work, work-main, Personal, p-main, Holidays
    await t.press('j', KEY.space)
    expect(t.client.calendars.setVisible).toHaveBeenCalledWith('work', 'work-main', false)
    await t.waitFor('[ ]')
    // A burst with no re-render in between (paste / fast typing) must still see each key's effect.
    for (const k of ['j', 'j', 'j', KEY.space]) t.stdin.write(k)
    await t.waitFor(() => t.client.calendars.setVisible.mock.calls.length === 2)
    expect(t.client.calendars.setVisible).toHaveBeenLastCalledWith('personal', 'p-holidays', false)
  })

  it('renames, recolours and syncs the selected account', async () => {
    await open()
    await t.press('j', 'j', 'e', ...Array(8).fill(KEY.backspace), 'H', 'o', 'm', 'e', KEY.enter)
    expect(t.client.accounts.update).toHaveBeenCalledWith('personal', { label: 'Home' })
    await t.waitFor('Renamed to Home')
    await t.press('c')
    expect(t.client.accounts.update).toHaveBeenLastCalledWith('personal', { color: '#8be9fd' })
    await t.press('r')
    expect(t.client.sync.now).toHaveBeenCalledWith('personal')
    await t.press('R')
    expect(t.client.sync.now).toHaveBeenLastCalledWith()
  })

  it('removes only after y confirm naming the account', async () => {
    await open()
    await t.press('x')
    await t.waitFor('Remove Work (me@work.example)? [y/N]')
    await t.press('n')
    expect(t.client.accounts.remove).not.toHaveBeenCalled()
    await t.press('x', 'y')
    expect(t.client.accounts.remove).toHaveBeenCalledWith('work')
    await t.waitFor((f) => !f.includes('me@work.example'))
  })

  it('adds a CalDAV account via preset, masking the password', async () => {
    t = renderWith(<Accounts onClose={() => {}} />)
    t.client.accounts.addCaldav.mockResolvedValue({ id: 'n', kind: 'caldav', label: 'Work', email: 'a@b.co', color: '#bd93f9' })
    await t.waitFor('Holidays')
    await t.press('a')
    await t.waitFor('Namecheap Private Email')
    await t.press(KEY.right) // iCloud
    await t.waitFor('https://caldav.icloud.com/')
    await t.press(KEY.tab, KEY.tab, ...'a@b.co', KEY.tab, ...'secret')
    const f = t.lastFrame()!
    expect(f).toContain('••••••')
    expect(f).not.toContain('secret')
    await t.press(KEY.enter)
    expect(t.client.accounts.addCaldav).toHaveBeenCalledWith({
      serverUrl: 'https://caldav.icloud.com/',
      username: 'a@b.co',
      password: 'secret',
      label: 'Work',
      color: '#bd93f9'
    })
    await t.waitFor('Account added')
  })

  it('shows CalDAV errors and esc backs out to the list', async () => {
    t = renderWith(<Accounts onClose={() => {}} />)
    await t.waitFor('Holidays')
    await t.press('a', KEY.tab, KEY.tab, ...'me@x.co', KEY.tab, 'p', KEY.enter)
    await t.waitFor('Not available in mock mode')
    await t.press(KEY.esc)
    await t.waitFor('Accounts & calendars')
  })

  it('reports Google sign-in errors', async () => {
    t = renderWith(<Accounts onClose={() => {}} />)
    await t.waitFor('Holidays')
    await t.press('g')
    await t.waitFor('Not available in mock mode')
    expect(t.client.accounts.addGoogle).toHaveBeenCalled()
  })

  it('shows the Google sign-in URL while waiting, for when no browser opens', async () => {
    t = renderWith(<Accounts onClose={() => {}} />)
    t.client.accounts.addGoogle.mockReturnValue(new Promise(() => {}))
    await t.waitFor('Holidays')
    await t.press('g')
    await t.waitFor('Opening browser')
    const url = 'https://accounts.example/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A41234&x=1'
    t.client.emitAuthUrl(url)
    await t.waitFor('ssh -L 41234:127.0.0.1:41234')
    expect(t.lastFrame()!.replace(/\s/g, '')).toContain(url)
    await t.press('c')
    await t.waitFor('clipboard')
    expect(t.frames.join('')).toContain(`\x1b]52;c;${Buffer.from(url).toString('base64')}\x07`)
  })
})
