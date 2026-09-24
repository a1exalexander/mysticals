import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { startTelemetry, telemetryOff } from './telemetry'

function setup(env: NodeJS.ProcessEnv = {}, key: string | undefined = 'phc_test') {
  const dir = mkdtempSync(join(tmpdir(), 'mysticals-telemetry-'))
  const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => new Response('{}'))
  const start = (allowed?: () => boolean) =>
    startTelemetry({ key, app: 'terminal', version: '1.2.3', dir, env, fetch, allowed })
  const bodies = () => fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
  return { dir, fetch, start, bodies }
}

describe('telemetry', () => {
  it('sends app_installed once per install with the anonymous payload', () => {
    const { dir, fetch, start, bodies } = setup()
    expect(start()?.installed).toBe(true)
    expect(start()?.installed).toBe(false) // second startup: id exists, nothing sent
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toBe('https://eu.i.posthog.com/i/v0/e/')
    expect(bodies()[0]).toEqual({
      api_key: 'phc_test',
      event: 'app_installed',
      distinct_id: readFileSync(join(dir, 'telemetry-id'), 'utf8'),
      properties: {
        app: 'terminal',
        version: '1.2.3',
        os: process.platform,
        arch: process.arch,
        $process_person_profiles: false,
        $geoip_disable: true
      }
    })
  })

  it('account_added carries only provider and preset, never extra fields', () => {
    const { start, bodies } = setup()
    const t = start()
    t?.track('account_added', { provider: 'caldav', preset: 'icloud', email: 'me@x.example' } as never)
    const { properties, distinct_id } = bodies()[1]
    expect(Object.keys(properties).sort()).toEqual(
      ['$geoip_disable', '$process_person_profiles', 'app', 'arch', 'os', 'preset', 'provider', 'version'].sort()
    )
    expect(properties).toMatchObject({ provider: 'caldav', preset: 'icloud' })
    expect(distinct_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each([
    ['no key', {}, ''],
    ['DO_NOT_TRACK=1', { DO_NOT_TRACK: '1' }],
    ['DO_NOT_TRACK=true', { DO_NOT_TRACK: 'true' }],
    ['MYSTICALS_TELEMETRY=0', { MYSTICALS_TELEMETRY: '0' }],
    ['mock mode', { MYSTICALS_MOCK: '1' }]
  ])('%s sends nothing', (_name, env: NodeJS.ProcessEnv, key = 'phc_test') => {
    const { fetch, start } = setup(env, key)
    expect(start()).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('DO_NOT_TRACK=0 does not opt out', () => expect(telemetryOff({ DO_NOT_TRACK: '0' })).toBe(false))

  it('the allowed() switch blocks events at send time', () => {
    const { fetch, start } = setup()
    let on = false
    const t = start(() => on)
    t?.track('account_added', { provider: 'google' })
    expect(fetch).not.toHaveBeenCalled()
    on = true
    t?.track('account_added', { provider: 'google' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('swallows network errors', async () => {
    const { fetch, start } = setup()
    fetch.mockRejectedValue(new Error('offline'))
    expect(() => start()).not.toThrow()
    await new Promise((r) => setTimeout(r))
  })
})
