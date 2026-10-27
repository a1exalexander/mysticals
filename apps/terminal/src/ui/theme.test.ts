import { afterEach, describe, expect, it } from 'vitest'
import { PALETTE } from './screens/AddCaldav'
import { ansiOf, C, setLightBackground } from './theme'

afterEach(() => setLightBackground(false))

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

  it('leaves near-white to the theme foreground, so it shows on light backgrounds too', () => {
    expect(ansiOf('#ffffff')).toBeUndefined()
    expect(ansiOf('#f0f0f0')).toBeUndefined()
  })

  it('swaps the yellows for darker ones on a light background, and back', () => {
    setLightBackground(true)
    expect(C.yellow).toBe('#9a6700')
    expect(ansiOf('#f1fa8c')).toBe('#9a6700') // yellow calendar
    expect(ansiOf('#ffb86c')).toBe('#bc4c00') // orange calendar
    expect(new Set(PALETTE.map(ansiOf)).size).toBe(PALETTE.length)
    setLightBackground(false)
    expect(C.yellow).toBe('yellow')
    expect(ansiOf('#ffb86c')).toBe('yellowBright')
  })
})
