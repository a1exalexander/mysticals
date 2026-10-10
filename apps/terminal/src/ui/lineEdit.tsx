/**
 * Single-line text fields with a cursor (event editor, Add CalDAV, account rename / new password).
 *   editLine: applies one key to { value, at } (`at` = cursor, in characters).
 *   LineView: the focused field, with an inverse cursor cell, scrolled sideways to keep the cursor in view.
 *   cursorText: the same inline, for short fields that sit inside a line of text.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Text, measureElement, type DOMElement, type Key } from 'ink'

export interface Line {
  value: string
  at: number
}

const CONTROL = /[\u0000-\u001f\u007f]/g

/**
 * One key applied to a field: ←/→ move, home/end (or ctrl+a / ctrl+e) jump, backspace erases before the cursor,
 * ctrl+u erases everything before it, typed or pasted text goes in at the cursor (control characters dropped).
 * Undefined for keys that aren't editing (enter, tab, ↑/↓, esc, other ctrl/meta combinations).
 */
export function editLine({ value, at }: Line, input: string, key: Key): Line | undefined {
  const chars = [...value]
  const pos = Math.min(Math.max(at, 0), chars.length)
  const line = (cursor: number, next = chars): Line => ({ value: next.join(''), at: Math.min(Math.max(cursor, 0), next.length) })
  if (key.leftArrow) return line(pos - 1)
  if (key.rightArrow) return line(pos + 1)
  if (key.home || (key.ctrl && input === 'a')) return line(0)
  if (key.end || (key.ctrl && input === 'e')) return line(chars.length)
  // ponytail: Ink reports Backspace and forward Delete alike on most terminals, so both erase before the cursor.
  if (key.backspace || key.delete) return line(pos - 1, pos ? [...chars.slice(0, pos - 1), ...chars.slice(pos)] : chars)
  if (key.ctrl && input === 'u') return line(0, chars.slice(pos))
  if (key.ctrl || key.meta || key.escape || key.return || key.tab || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return
  const typed = [...input.replace(CONTROL, '')]
  if (!typed.length) return
  return line(pos + typed.length, [...chars.slice(0, pos), ...typed, ...chars.slice(pos)])
}

/** `value` with the character under the cursor (a space at the end) in inverse; `mask` replaces every character. */
export function cursorText({ value, at }: Line, mask?: string): ReactNode {
  const chars = [...value].map((c) => mask ?? c)
  return (
    <>
      {chars.slice(0, at).join('')}
      <Text inverse>{chars[at] ?? ' '}</Text>
      {chars.slice(at + 1).join('')}
    </>
  )
}

/** The focused field: takes the rest of its row and slides so the cursor stays visible. */
export function LineView({ value, at, mask }: Line & { mask?: string }) {
  const box = useRef<DOMElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (box.current) setWidth(measureElement(box.current).width)
  })
  const chars = [...value].map((c) => mask ?? c)
  const room = Math.max(width, 1)
  // First shown character: moves only as far as needed to keep the cursor cell (which may be one past the end) in view.
  const from = useRef(0)
  from.current = Math.max(Math.min(from.current, at, Math.max(chars.length + 1 - room, 0)), at - room + 1, 0)
  const f = from.current
  return (
    <Box ref={box} flexGrow={1} flexShrink={1} height={1} overflow="hidden">
      <Text wrap="truncate-end">{cursorText({ value: chars.slice(f, f + room).join(''), at: at - f })}</Text>
    </Box>
  )
}
