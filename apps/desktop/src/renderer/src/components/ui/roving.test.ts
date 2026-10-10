import { describe, expect, it } from 'vitest'
import { rovingIndex } from './roving'

describe('rovingIndex', () => {
  it('steps and wraps both ways', () => {
    expect(rovingIndex('ArrowRight', 1, 4, false)).toBe(2)
    expect(rovingIndex('ArrowRight', 3, 4, false)).toBe(0)
    expect(rovingIndex('ArrowLeft', 0, 4, false)).toBe(3)
    expect(rovingIndex('ArrowDown', 3, 4, true)).toBe(0)
    expect(rovingIndex('ArrowUp', 2, 4, true)).toBe(1)
  })

  it('jumps to the ends', () => {
    expect(rovingIndex('Home', 2, 4, false)).toBe(0)
    expect(rovingIndex('End', 0, 4, false)).toBe(3)
  })

  it('ignores Up/Down unless vertical, and other keys', () => {
    expect(rovingIndex('ArrowDown', 1, 4, false)).toBe(-1)
    expect(rovingIndex('ArrowUp', 1, 4, false)).toBe(-1)
    expect(rovingIndex('Enter', 1, 4, true)).toBe(-1)
  })
})
