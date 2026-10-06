import { describe, expect, it } from 'vitest'
import { keyStep, pct, snap, valueFromPointer } from './Range.logic'

describe('snap', () => {
  it('rounds to the step and clamps', () => {
    expect(snap(6.3, 1, 12, 0.5)).toBe(6.5)
    expect(snap(6.2, 1, 12, 0.5)).toBe(6)
    expect(snap(-4, 1, 12, 0.5)).toBe(1)
    expect(snap(40, 1, 12, 0.5)).toBe(12)
  })

  it('counts steps from min', () => {
    expect(snap(4, 1, 10, 2)).toBe(5)
  })
})

describe('pct', () => {
  it('maps the range to 0–100', () => {
    expect(pct(1, 1, 12)).toBe(0)
    expect(pct(12, 1, 12)).toBe(100)
    expect(pct(6.5, 1, 12)).toBe(50)
  })
})

describe('valueFromPointer', () => {
  it('snaps the pointer position, clamping outside the track', () => {
    expect(valueFromPointer(150, 100, 220, 1, 12, 0.5)).toBe(3.5)
    expect(valueFromPointer(0, 100, 220, 1, 12, 0.5)).toBe(1)
    expect(valueFromPointer(999, 100, 220, 1, 12, 0.5)).toBe(12)
  })
})

describe('keyStep', () => {
  it('steps with arrows, jumps with Page keys, and goes to the ends with Home/End', () => {
    expect(keyStep('ArrowRight', 6, 1, 12, 0.5, 1)).toBe(6.5)
    expect(keyStep('ArrowDown', 6, 1, 12, 0.5, 1)).toBe(5.5)
    expect(keyStep('PageUp', 11.5, 1, 12, 0.5, 1)).toBe(12)
    expect(keyStep('Home', 6, 1, 12, 0.5, 1)).toBe(1)
    expect(keyStep('End', 6, 1, 12, 0.5, 1)).toBe(12)
    expect(keyStep('a', 6, 1, 12, 0.5, 1)).toBeNull()
  })
})
