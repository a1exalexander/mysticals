import { t, type Locale } from '../i18n'
import type { CalEvent } from '../shared/types'
import { linkify } from './details'
import { eventBounds } from './layout'

/** First http(s) URL in a location string, with trailing punctuation stripped. */
export function meetingUrl(location?: string): string | undefined {
  return location?.match(/https?:\/\/[^\s<>"]+/i)?.[0].replace(/[.,;:!?)\]}'>]+$/, '')
}

/** The event's call link: the provider's conference (Google Meet) first, else the first link in its location. */
export function eventMeetingUrl(e: Pick<CalEvent, 'conferenceUrl' | 'location'>): string | undefined {
  return e.conferenceUrl ?? meetingUrl(e.location)
}

/** Location without its links ("Room 3 / https://…" → "Room 3"); empty when it is only links. */
export function locationText(location = ''): string {
  return location.replace(/https?:\/\/[^\s<>"]+/gi, '').replace(/^[\s/|,·-]+|[\s/|,·-]+$/g, '')
}

/** Location without its meeting links ("Room 3 / https://…" → "Room 3"); "video call" when it is only links. */
export function place(location = '', locale: Locale = 'en'): string {
  return locationText(location) || (meetingUrl(location) ? t(locale, 'meeting.videoCall') : '')
}

/** `place` of an event: also "video call" when the only call link is the provider's conference. */
export function eventPlace(e: Pick<CalEvent, 'conferenceUrl' | 'location'>, locale: Locale = 'en'): string {
  return place(e.location, locale) || (e.conferenceUrl ? t(locale, 'meeting.videoCall') : '')
}

/** A call can be joined from this many minutes before its start. */
export const JOIN_EARLY_MIN = 5

/** Meeting link of `e` while it can be joined at `now`: from JOIN_EARLY_MIN before its start until its end. */
export function joinable(e: CalEvent, now: Date): string | undefined {
  const url = eventMeetingUrl(e)
  if (!url || e.allDay) return undefined
  const { start, end } = eventBounds(e)
  return start.getTime() - JOIN_EARLY_MIN * 60_000 <= now.getTime() && now < end ? url : undefined
}

export type LinkKind = 'meet' | 'zoom' | 'teams' | 'video' | 'map' | 'link'

const host = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const is = (h: string, domain: string): boolean => h === domain || h.endsWith(`.${domain}`)

/** What a link points to, by its host: a known call service, some other video call, a map, or anything else. */
export function linkKind(url: string): LinkKind {
  const h = host(url)
  const path = url.replace(/^https?:\/\/[^/]+/i, '').toLowerCase()
  if (h === 'meet.google.com') return 'meet'
  if (is(h, 'zoom.us') || is(h, 'zoom.com') || is(h, 'zoomgov.com')) return 'zoom'
  if (h === 'teams.microsoft.com' || h === 'teams.live.com') return 'teams'
  if (
    /^(maps|map)\./.test(h) ||
    (/^google\.[a-z.]+$/.test(h) && path.startsWith('/maps')) ||
    (h === 'goo.gl' && path.startsWith('/maps')) ||
    h === 'maps.app.goo.gl' ||
    is(h, 'waze.com') ||
    is(h, 'openstreetmap.org')
  )
    return 'map'
  if (
    /^(meet|video|call|calls|conf|jitsi|webinar)\./.test(h) ||
    ['meet.jit.si', 'whereby.com', 'discord.gg', 'facetime.apple.com', 'gather.town', 'around.co', 'chime.aws'].some((d) => is(h, d)) ||
    is(h, 'webex.com') ||
    (h === 'app.slack.com' && path.startsWith('/huddle'))
  )
    return 'video'
  return 'link'
}

/** Short button text for a link of `kind`. */
export function linkLabel(url: string, kind = linkKind(url), locale: Locale = 'en'): string {
  if (kind === 'link') return host(url) || url
  return t(locale, `link.${kind}`, kind === 'video' ? { host: host(url) } : undefined)
}

export type EventLink = { url: string; kind: LinkKind }

/** Every link of an event as buttons: its conference first, then the links in its location, deduped. */
export function eventLinks(e: Pick<CalEvent, 'conferenceUrl' | 'location'>): EventLink[] {
  const urls = [e.conferenceUrl, ...linkify(e.location ?? '').map((p) => p.href)]
  const seen = new Set<string>()
  const out: EventLink[] = []
  for (const url of urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, kind: linkKind(url) })
  }
  return out
}
