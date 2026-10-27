import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { detectLightBackground, isLightBackground, replyLuminance } from './background'

describe('isLightBackground', () => {
  it('reads the OSC 11 reply, 1-4 hex digits per channel, BEL or ST terminated', () => {
    expect(isLightBackground('\x1b]11;rgb:ffff/ffff/ffff\x07', undefined)).toBe(true)
    expect(isLightBackground('\x1b]11;rgb:fd/f6/e3\x1b\\', undefined)).toBe(true) // Solarized light
    expect(isLightBackground('\x1b]11;rgb:0000/2b2b/3636\x07', undefined)).toBe(false) // Solarized dark
    expect(isLightBackground('\x1b]11;rgba:1e1e/1e1e/1e1e/ffff\x07', undefined)).toBe(false)
    expect(replyLuminance('\x1b]11;rgb:f/f/f\x07')).toBe(1)
  })

  it('trusts the reply over COLORFGBG, else uses COLORFGBG, else says dark', () => {
    expect(isLightBackground('\x1b]11;rgb:0000/0000/0000\x07', '0;15')).toBe(false)
    expect(isLightBackground('\x1b[?62;22c', '0;15')).toBe(true) // only DA1 came back
    expect(isLightBackground('', '0;7')).toBe(true)
    expect(isLightBackground('', '15;0')).toBe(false)
    expect(isLightBackground('', '15;default;8')).toBe(false)
    expect(isLightBackground('', '0;default')).toBe(false)
    expect(isLightBackground('', undefined)).toBe(false)
    expect(isLightBackground('garbage', '')).toBe(false)
  })
})

/** A TTY stdin whose terminal answers `reply` (or nothing) to whatever is written to stdout. */
function fakeTerminal(reply?: string) {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(function (this: { isRaw: boolean }, on: boolean) {
      this.isRaw = on
      return this
    }),
    resume: vi.fn(),
    pause: vi.fn()
  })
  const stdout = {
    isTTY: true,
    write: vi.fn((_: string) => {
      if (reply !== undefined) setTimeout(() => stdin.emit('data', Buffer.from(reply)), 5)
      return true
    })
  }
  return { stdin, stdout }
}

describe('detectLightBackground', () => {
  it('asks OSC 11 then DA1, stops at the DA1 reply and puts stdin back as it was', async () => {
    const { stdin, stdout } = fakeTerminal('\x1b]11;rgb:ffff/ffff/ffff\x07\x1b[?62;22c')
    const start = Date.now()
    const light = await detectLightBackground(stdin as never, stdout as never, {}, 5000)
    expect(light).toBe(true)
    expect(Date.now() - start).toBeLessThan(1000) // ended by DA1, not the timeout
    expect(stdout.write).toHaveBeenCalledWith('\x1b]11;?\x07\x1b[c')
    expect(stdin.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(stdin.isRaw).toBe(false)
    expect(stdin.pause).toHaveBeenCalled()
    expect(stdin.listenerCount('data')).toBe(0)
  })

  it('falls back to COLORFGBG after the timeout when the terminal says nothing', async () => {
    const { stdin, stdout } = fakeTerminal()
    expect(await detectLightBackground(stdin as never, stdout as never, { COLORFGBG: '0;15' }, 20)).toBe(true)
    expect(stdin.isRaw).toBe(false)
    expect(stdin.listenerCount('data')).toBe(0)
  })

  it('keeps raw mode on when it was on already', async () => {
    const { stdin, stdout } = fakeTerminal('\x1b[?1;2c')
    stdin.isRaw = true
    expect(await detectLightBackground(stdin as never, stdout as never, {}, 5000)).toBe(false)
    expect(stdin.isRaw).toBe(true)
  })

  it('never queries without a TTY or with NO_COLOR, and says dark', async () => {
    for (const [tty, env] of [[false, {}], [true, { NO_COLOR: '1', COLORFGBG: '0;15' }]] as const) {
      const { stdin, stdout } = fakeTerminal('\x1b]11;rgb:ffff/ffff/ffff\x07\x1b[?62c')
      stdin.isTTY = tty
      expect(await detectLightBackground(stdin as never, stdout as never, env, 20)).toBe(false)
      expect(stdout.write).not.toHaveBeenCalled()
      expect(stdin.setRawMode).not.toHaveBeenCalled()
    }
  })

  it('resolves even when raw mode is refused', async () => {
    const { stdin, stdout } = fakeTerminal()
    stdin.setRawMode.mockImplementation(() => {
      throw new Error('EIO')
    })
    expect(await detectLightBackground(stdin as never, stdout as never, {}, 5000)).toBe(false)
  })
})
