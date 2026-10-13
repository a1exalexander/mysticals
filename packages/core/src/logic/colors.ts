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

/** The colorId of an ICS COLOR value. ponytail: only the palette's own names; any other colour shows the calendar's. */
export const colorIdFromCss = (name: unknown): string | undefined => {
  const n = String(name ?? '').trim().toLowerCase()
  return EVENT_COLORS.find((c) => c.css === n)?.id
}
