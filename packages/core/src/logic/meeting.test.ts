import { describe, expect, it } from 'vitest'
import { meetingUrl, place } from './meeting'

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
    expect(place('Kyiv')).toBe('Kyiv')
    expect(place(undefined)).toBe('')
  })
})
