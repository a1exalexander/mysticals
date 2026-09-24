import { describe, expect, it } from 'vitest'
import { encode, isMethod, lineReader } from './protocol'

describe('lineReader', () => {
  it('reassembles messages split across chunks and skips bad lines', () => {
    const got: unknown[] = []
    const bad: string[] = []
    const feed = lineReader((m) => got.push(m), (l) => bad.push(l))
    const wire = encode({ id: 1, result: 'a\nb' }) + 'nope\n' + encode({ event: 'changed', accountId: 'w' })
    for (const ch of wire) feed(ch)
    expect(got).toEqual([{ id: 1, result: 'a\nb' }, { event: 'changed', accountId: 'w' }])
    expect(bad).toEqual(['nope'])
  })

  it('reads a large message fed in many chunks', () => {
    const got: unknown[] = []
    const feed = lineReader((m) => got.push(m))
    const wire = encode({ id: 1, result: 'x'.repeat(1_000_000) })
    for (let i = 0; i < wire.length; i += 65_536) feed(wire.slice(i, i + 65_536))
    expect(got).toEqual([{ id: 1, result: 'x'.repeat(1_000_000) }])
  })

  it('keeps multi-byte characters split across byte chunks', () => {
    const got: unknown[] = []
    const feed = lineReader((m) => got.push(m))
    const bytes = Buffer.from(encode({ id: 1, result: 'Зустріч 🎉' }))
    for (let i = 0; i < bytes.length; i++) feed(bytes.subarray(i, i + 1))
    expect(got).toEqual([{ id: 1, result: 'Зустріч 🎉' }])
  })
})

describe('isMethod', () => {
  it('accepts Api paths only', () => {
    expect(isMethod('events.create')).toBe(true)
    for (const m of ['events', 'events.nope', '__proto__.x', 'constructor', 'toString', 1, undefined]) expect(isMethod(m)).toBe(false)
  })
})
