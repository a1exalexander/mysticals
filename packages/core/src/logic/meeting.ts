/** First http(s) URL in a location string, with trailing punctuation stripped. */
export function meetingUrl(location?: string): string | undefined {
  return location?.match(/https?:\/\/[^\s<>"]+/i)?.[0].replace(/[.,;:!?)\]}'>]+$/, '')
}
