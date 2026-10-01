import type { CalEvent } from '../shared/types'
import { eventBounds } from './layout'

/** First http(s) URL in a location string, with trailing punctuation stripped. */
export function meetingUrl(location?: string): string | undefined {
  return location?.match(/https?:\/\/[^\s<>"]+/i)?.[0].replace(/[.,;:!?)\]}'>]+$/, '')
}

/** Location without its meeting links ("Room 3 / https://…" → "Room 3"); "video call" when it is only links. */
export function place(location = ''): string {
  const rest = location.replace(/https?:\/\/[^\s<>"]+/gi, '').replace(/^[\s/|,·-]+|[\s/|,·-]+$/g, '')
  return rest || (meetingUrl(location) ? 'video call' : '')
}

/** A call can be joined from this many minutes before its start. */
export const JOIN_EARLY_MIN = 5

/** Meeting link of `e` while it can be joined at `now`: from JOIN_EARLY_MIN before its start until its end. */
export function joinable(e: CalEvent, now: Date): string | undefined {
  const url = meetingUrl(e.location)
  if (!url || e.allDay) return undefined
  const { start, end } = eventBounds(e)
  return start.getTime() - JOIN_EARLY_MIN * 60_000 <= now.getTime() && now < end ? url : undefined
}
