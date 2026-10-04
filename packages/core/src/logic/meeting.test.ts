import { describe, expect, it } from 'vitest'
import type { CalEvent } from '../shared/types'
import { joinable, meetingUrl, place } from './meeting'

describe('meetingUrl', () => {
  it('extracts the first http(s) url', () => {
    expect(meetingUrl('Join: https://meet.google.com/abc-defg-hij.')).toBe('https://meet.google.com/abc-defg-hij')
    expect(meetingUrl('(https://zoom.us/j/1?pwd=x), http://b.example')).toBe('https://zoom.us/j/1?pwd=x')
    expect(meetingUrl('http://x.example/a')).toBe('http://x.example/a')
  })
  it('returns undefined without a url', () => {
    expect(meetingUrl(undefined)).toBeUndefined()
    expect(meetingUrl('Room 3')).toBeUndefined()
    expect(meetingUrl('ftp://x.example')).toBeUndefined()
  })
})

describe('place', () => {
  it('drops the meeting link from a location', () => {
    expect(place('Room 3 / https://meet.example.com/x')).toBe('Room 3')
    expect(place('https://meet.google.com/abc-defg-hij')).toBe('video call')
    expect(place('https://meet.google.com/abc-defg-hij', 'uk')).toBe('відеодзвінок')
    expect(place('Kyiv')).toBe('Kyiv')
    expect(place(undefined)).toBe('')
  })
  it('leaves no link behind when there are several', () => {
    expect(place('https://zoom.us/j/1?pwd=x, https://zoom.us/j/2')).toBe('video call')
    expect(place('Zoom https://zoom.us/j/1\nhttps://zoom.us/j/1?pwd=x')).toBe('Zoom')
  })
})

describe('joinable', () => {
  const e = (location?: string, allDay = false): CalEvent => ({
    id: 'x', accountId: 'a', calendarId: 'c', title: 'Sync', start: '2026-10-02T10:00:00', end: '2026-10-02T10:30:00', allDay, location, attendees: []
  })
  const at = (hm: string): Date => new Date(`2026-10-02T${hm}:00`)
  it('opens 5 minutes before the start and closes at the end', () => {
    const z = e('Zoom https://zoom.us/j/1')
    expect(joinable(z, at('09:54'))).toBeUndefined()
    expect(joinable(z, at('09:55'))).toBe('https://zoom.us/j/1')
    expect(joinable(z, at('10:29'))).toBe('https://zoom.us/j/1')
    expect(joinable(z, at('10:30'))).toBeUndefined()
  })
  it('needs a link in the location and a timed event', () => {
    expect(joinable(e('Room 3'), at('10:00'))).toBeUndefined()
    expect(joinable(e(), at('10:00'))).toBeUndefined()
    expect(joinable(e('https://meet.google.com/abc', true), at('10:00'))).toBeUndefined()
  })
})
