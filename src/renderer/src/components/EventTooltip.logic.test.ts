import { describe, expect, it } from 'vitest'
import { meetingUrl, placeTip } from './EventTooltip.logic'

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

describe('placeTip', () => {
  const vp = { w: 800, h: 600 }
  const tip = { w: 200, h: 30 }
  it('places below the anchor', () => {
    expect(placeTip({ top: 100, bottom: 120, left: 50 }, tip, vp)).toEqual({ top: 124, left: 50 })
  })
  it('flips above when there is no room below', () => {
    expect(placeTip({ top: 560, bottom: 590, left: 50 }, tip, vp)).toEqual({ top: 526, left: 50 })
  })
  it('clamps into the viewport', () => {
    expect(placeTip({ top: -500, bottom: 2000, left: 750 }, tip, vp)).toEqual({ top: 4, left: 596 })
  })
})
