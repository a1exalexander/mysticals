import { describe, expect, it } from 'vitest'
import { EVENT_COLORS, nearestEventColor } from './colors'

const key = (hex: string): string => EVENT_COLORS[nearestEventColor(hex)].key

describe('nearestEventColor', () => {
  it('maps every event colour to itself', () => {
    expect(EVENT_COLORS.map((c) => key(c.hex))).toEqual(EVENT_COLORS.map((c) => c.key))
  })
  it('maps greys to graphite and calendar colours to their nearest hue', () => {
    expect(['#c2c2c2', '#8e8e93', '#ffffff'].map(key)).toEqual(['graphite', 'graphite', 'graphite'])
    expect(['#fbe983', '#9fe1e7', '#f691b2', '#42d692', '#9a9cff', '#4285f4', '#f83a22', '#ff5555', '#50fa7b'].map(key)).toEqual(
      ['banana', 'peacock', 'flamingo', 'sage', 'lavender', 'blueberry', 'tomato', 'tomato', 'sage']
    )
  })
})
