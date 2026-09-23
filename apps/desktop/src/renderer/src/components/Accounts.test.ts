import { describe, expect, it } from 'vitest'
import { errorText, suggestLabel } from './AccountsShared'

describe('suggestLabel', () => {
  it('suggests Personal for consumer domains and Work otherwise', () => {
    expect(suggestLabel('me@gmail.com')).toBe('Personal')
    expect(suggestLabel('me@icloud.com')).toBe('Personal')
    expect(suggestLabel('me@acme.io')).toBe('Work')
    expect(suggestLabel('me')).toBe('')
  })
})

describe('errorText', () => {
  it('strips the Electron IPC prefix', () => {
    const e = new Error("Error invoking remote method 'accounts:addCaldav': Error: Not available in mock mode")
    expect(errorText(e)).toBe('Not available in mock mode')
    expect(errorText(new Error('plain'))).toBe('plain')
  })
})
