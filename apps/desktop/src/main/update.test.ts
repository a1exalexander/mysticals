import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
const { newer, verifyTeam } = await import('./update')

describe.skipIf(process.platform !== 'darwin')('verifyTeam', () => {
  // Calendar.app is Apple-signed, so a Developer ID team requirement parses but does not match.
  it('checks the inline requirement instead of reading it as a file', async () => {
    await expect(verifyTeam('/System/Applications/Calendar.app', 'ABCDE12345')).rejects.toThrow(/failed to satisfy/)
  })
})

describe('newer', () => {
  it('compares numeric x.y.z', () => {
    expect(newer('0.2.0', '0.1.9')).toBe(true)
    expect(newer('0.10.0', '0.9.0')).toBe(true)
    expect(newer('1.0.0', '1.0.0')).toBe(false)
    expect(newer('0.1.0', '0.1.1')).toBe(false)
  })
})
