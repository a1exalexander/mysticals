import { describe, expect, it } from 'vitest'
import type { Key } from 'ink'
import { editLine } from './lineEdit'

const none: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false, home: false, end: false,
  return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
  super: false, hyper: false, capsLock: false, numLock: false
}
const k = (over: Partial<Key>): Key => ({ ...none, ...over })
const type = (value: string, at: number, input: string, key: Partial<Key> = {}) => editLine({ value, at }, input, k(key))

describe('editLine', () => {
  it('inserts typed and pasted text at the cursor, without control characters', () => {
    expect(type('Sandup', 1, 't')).toEqual({ value: 'Standup', at: 2 })
    expect(type('Team ', 5, 'sync\r\n')).toEqual({ value: 'Team sync', at: 9 })
    expect(type('ab', 1, '🎉')).toEqual({ value: 'a🎉b', at: 2 })
  })

  it('moves by character, jumps to the ends, never leaves the text', () => {
    expect(type('a🎉b', 3, '', { leftArrow: true })).toEqual({ value: 'a🎉b', at: 2 })
    expect(type('abc', 3, '', { rightArrow: true })).toEqual({ value: 'abc', at: 3 })
    expect(type('abc', 0, '', { leftArrow: true })).toEqual({ value: 'abc', at: 0 })
    expect(type('abc', 2, 'a', { ctrl: true })).toEqual({ value: 'abc', at: 0 })
    expect(type('abc', 0, '', { end: true })).toEqual({ value: 'abc', at: 3 })
  })

  it('erases before the cursor; ctrl+u erases everything before it', () => {
    expect(type('Standup', 2, '', { backspace: true })).toEqual({ value: 'Sandup', at: 1 })
    expect(type('Standup', 2, '', { delete: true })).toEqual({ value: 'Sandup', at: 1 })
    expect(type('abc', 0, '', { backspace: true })).toEqual({ value: 'abc', at: 0 })
    expect(type('hello world', 6, 'u', { ctrl: true })).toEqual({ value: 'world', at: 0 })
  })

  it('leaves navigation and submit keys to the form', () => {
    for (const key of [{ return: true }, { tab: true }, { upArrow: true }, { downArrow: true }, { escape: true }, { ctrl: true }]) {
      expect(type('abc', 1, key.ctrl ? 's' : '', key)).toBeUndefined()
    }
  })
})
