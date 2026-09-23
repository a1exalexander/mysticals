import { describe, expect, it } from 'vitest'
import { PALETTE } from './screens/AddCaldav'
import { ansiOf } from './theme'

describe('ansiOf', () => {
  it('keeps the default account colors distinct', () => {
    const mapped = PALETTE.map(ansiOf)
    expect(new Set(mapped).size).toBe(PALETTE.length)
    expect(mapped).toEqual(['magenta', 'green', 'cyan', 'magentaBright', 'yellowBright', 'yellow'])
  })

  it('maps greys and bad input to gray, primaries by hue', () => {
    expect(ansiOf('#808080')).toBe('gray')
    expect(ansiOf('nope')).toBe('gray')
    expect(ansiOf('#ff0000')).toBe('red')
    expect(ansiOf('#1a73e8')).toBe('blue')
  })
})
