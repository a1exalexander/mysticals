import type { CalEvent } from '../shared/types'

/**
 * Per-event colours: Google's 11 event colours, in its `colorId` order, with the hexes its web UI draws.
 * CalDAV keeps the same choice as an RFC 7986 COLOR (a CSS3 colour name, the nearest one to the hex).
 */
export const EVENT_COLORS = [
  { id: '1', key: 'lavender', hex: '#7986cb', css: 'mediumslateblue' },
  { id: '2', key: 'sage', hex: '#33b679', css: 'mediumseagreen' },
  { id: '3', key: 'grape', hex: '#8e24aa', css: 'darkorchid' },
  { id: '4', key: 'flamingo', hex: '#e67c73', css: 'lightcoral' },
  { id: '5', key: 'banana', hex: '#f6bf26', css: 'gold' },
  { id: '6', key: 'tangerine', hex: '#f4511e', css: 'orangered' },
  { id: '7', key: 'peacock', hex: '#039be5', css: 'deepskyblue' },
  { id: '8', key: 'graphite', hex: '#616161', css: 'dimgray' },
  { id: '9', key: 'blueberry', hex: '#3f51b5', css: 'royalblue' },
  { id: '10', key: 'basil', hex: '#0b8043', css: 'seagreen' },
  { id: '11', key: 'tomato', hex: '#d50000', css: 'red' }
] as const

export type EventColor = (typeof EVENT_COLORS)[number]
export const EVENT_COLOR_IDS = EVENT_COLORS.map((c) => c.id) as [EventColor['id'], ...EventColor['id'][]]

export const FALLBACK_COLOR = '#6272a4'

export const eventColor = (colorId?: string): EventColor | undefined => EVENT_COLORS.find((c) => c.id === colorId)

/** What an event is drawn in: its own colour, else its calendar's, else its account's. */
export const eventColorOf = (e: Pick<CalEvent, 'colorId'>, calendar?: { color?: string }, account?: { color?: string }): string =>
  eventColor(e.colorId)?.hex ?? calendar?.color ?? account?.color ?? FALLBACK_COLOR

/** Oklab [L, a, b] of a #rrggbb hex. */
const oklab = (hex: string): number[] => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}
const LABS = EVENT_COLORS.map((c) => oklab(c.hex))
const GRAPHITE = EVENT_COLORS.findIndex((c) => c.key === 'graphite')

/**
 * Index in EVENT_COLORS of the event colour nearest a #rrggbb hex, so theme palettes can redraw any calendar colour.
 * Hue decides (pastel calendar colours are far lighter than the event colours); chroma, then lightness, split same-hue
 * pairs (tomato/flamingo, sage/basil, lavender/blueberry); near-greys are graphite. ponytail: any calendar colour
 * collapses to 11 slots, so two close calendar colours can land on the same one.
 */
export const nearestEventColor = (hex: string): number => {
  const [L, a, b] = oklab(hex)
  const c = Math.hypot(a, b)
  if (c < 0.035) return GRAPHITE
  let best = GRAPHITE
  let min = Infinity
  LABS.forEach(([L2, a2, b2], i) => {
    if (i === GRAPHITE) return
    const c2 = Math.hypot(a2, b2)
    const d = Math.hypot(a / c - a2 / c2, b / c - b2 / c2) + 3 * Math.abs(c - c2) + 0.5 * Math.abs(L - L2)
    if (d < min) [best, min] = [i, d]
  })
  return best
}

/** The colorId of an ICS COLOR value. ponytail: only the palette's own names; any other colour shows the calendar's. */
export const colorIdFromCss = (name: unknown): string | undefined => {
  const n = String(name ?? '').trim().toLowerCase()
  return EVENT_COLORS.find((c) => c.css === n)?.id
}
