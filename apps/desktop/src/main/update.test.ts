import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
const { newer } = await import('./update')

describe('newer', () => {
  it('compares numeric x.y.z', () => {
    expect(newer('0.2.0', '0.1.9')).toBe(true)
    expect(newer('0.10.0', '0.9.0')).toBe(true)
    expect(newer('1.0.0', '1.0.0')).toBe(false)
    expect(newer('0.1.0', '0.1.1')).toBe(false)
  })
})
