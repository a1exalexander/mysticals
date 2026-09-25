/** First http(s) URL in a location string, with trailing punctuation stripped. */
export function meetingUrl(location?: string): string | undefined {
  return location?.match(/https?:\/\/[^\s<>"]+/i)?.[0].replace(/[.,;:!?)\]}'>]+$/, '')
}

/** Location without its meeting link ("Room 3 / https://…" → "Room 3"); "video call" when it is only a link. */
export function place(location = ''): string {
  const url = meetingUrl(location)
  const rest = (url ? location.replace(url, '') : location).replace(/^[\s/|,·-]+|[\s/|,·-]+$/g, '')
  return rest || (url ? 'video call' : '')
}
