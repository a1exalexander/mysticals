import { describe, expect, it } from 'vitest'
import { edge, step, typeahead } from './Select.logic'

const items = [
  { label: 'Choose…', disabled: true },
  { label: 'Work' },
  { label: 'Holidays', disabled: true },
  { label: 'Personal' },
  { label: 'Projects' }
]

describe('step', () => {
  it('skips disabled items', () => {
    expect(step(items, 1, 1)).toBe(3)
    expect(step(items, 3, -1)).toBe(1)
  })
  it('stays put at the ends', () => {
    expect(step(items, 4, 1)).toBe(4)
    expect(step(items, 1, -1)).toBe(1)
  })
  it('starts from an edge when nothing is active', () => {
    expect(step(items, -1, 1)).toBe(1)
    expect(step(items, -1, -1)).toBe(4)
  })
})

describe('edge', () => {
  it('finds the first and last enabled items', () => {
    expect(edge(items, 1)).toBe(1)
    expect(edge(items, -1)).toBe(4)
    expect(edge([{ label: 'x', disabled: true }], 1)).toBe(-1)
  })
})

describe('typeahead', () => {
  it('jumps to the next match after the current item, wrapping', () => {
    expect(typeahead(items, 1, 'p')).toBe(3)
    expect(typeahead(items, 3, 'p')).toBe(4)
    expect(typeahead(items, 4, 'P')).toBe(3)
    expect(typeahead(items, -1, 'w')).toBe(1)
  })
  it('ignores disabled items and misses', () => {
    expect(typeahead(items, 1, 'h')).toBe(-1)
    expect(typeahead(items, 1, 'z')).toBe(-1)
  })
  it('matches a longer prefix', () => {
    expect(typeahead(items, 3, 'pr')).toBe(4)
  })
})
