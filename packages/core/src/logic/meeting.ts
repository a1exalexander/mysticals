/** First http(s) URL in a location string, with trailing punctuation stripped. */
export function meetingUrl(location?: string): string | undefined {
  return location?.match(/https?:\/\/[^\s<>"]+/i)?.[0].replace(/[.,;:!?)\]}'>]+$/, '')
}

/** Location without its meeting links ("Room 3 / https://…" → "Room 3"); "video call" when it is only links. */
export function place(location = ''): string {
  const rest = location.replace(/https?:\/\/[^\s<>"]+/gi, '').replace(/^[\s/|,·-]+|[\s/|,·-]+$/g, '')
  return rest || (meetingUrl(location) ? 'video call' : '')
}
