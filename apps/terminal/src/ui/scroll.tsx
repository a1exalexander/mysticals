/**
 * Scrolling for whatever is taller than the rows it gets.
 *   useScroll: first visible row of a list of one-row lines that follows a selection (agenda, time grid, panels' lists).
 *   useScrollArea + <Scroll>: a clipped viewport over content of any height (event details, help), moved by keys/wheel.
 *   useHeight: measured height of an element, for panels that fit a scroll area between a header and a footer.
 */
import { useLayoutEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Box, measureElement, type DOMElement } from 'ink'
import { Clickable } from './mouse'

/** Wheel notch in lines. */
export const WHEEL_STEP = 3

/**
 * First visible row of a `total`-row list shown `height` rows at a time, plus `scrollBy` for the mouse wheel.
 * When `first..last` (the selection) changes, moves only as far as needed to keep it in view (so j/k don't jump
 * the page; `first` wins if they don't fit), starting at `first`. A wheel scroll stays until the selection moves.
 */
export function useScroll(first: number, last: number, height: number, total: number): [number, (rows: number) => void] {
  const off = useRef<number>(undefined)
  const followed = useRef('')
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const clamp = (o: number): number => Math.max(0, Math.min(o, total - height))
  let o = off.current ?? first
  if (followed.current !== `${first}/${last}`) {
    followed.current = `${first}/${last}`
    if (last >= o + height) o = last - height + 1
    if (first < o) o = first
  }
  o = clamp(o)
  off.current = o
  const scrollBy = (rows: number): void => {
    const next = clamp((off.current ?? 0) + rows)
    if (next === off.current) return
    off.current = next
    rerender()
  }
  return [o, scrollBy]
}

/** Rendered height of the element `ref` is attached to (0 until the first layout). */
export function useHeight(): [RefObject<DOMElement | null>, number] {
  const ref = useRef<DOMElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    if (ref.current) setHeight(measureElement(ref.current).height)
  })
  return [ref, height]
}

interface ScrollView {
  rows: number
  top: number
  onMeasure(height: number): void
  onWheel(dir: 1 | -1): void
}

/**
 * Scroll state for content shown in at most `max` rows: `view` goes on a <Scroll>, `scrollBy` on keys,
 * `more` tells whether anything is cut off.
 */
export function useScrollArea(max: number): { view: ScrollView; more: boolean; scrollBy(rows: number): void } {
  const [content, setContent] = useState(0)
  const [top, setTop] = useState(0)
  const limit = Math.max(content - Math.max(max, 1), 0)
  const scrollBy = (rows: number): void => setTop((t) => Math.max(0, Math.min(Math.min(t, limit) + rows, limit)))
  return {
    // never 0 rows: Yoga lays out nothing inside a zero-height box, so the content could not be measured
    view: { rows: Math.max(Math.min(content, max), 1), top: Math.min(top, limit), onMeasure: setContent, onWheel: (dir) => scrollBy(dir * WHEEL_STEP) },
    more: limit > 0,
    scrollBy
  }
}

/** `children` clipped to `rows` rows from row `top`; the wheel scrolls them. */
export function Scroll({ rows, top, onMeasure, onWheel, children }: ScrollView & { children: ReactNode }) {
  const inner = useRef<DOMElement>(null)
  useLayoutEffect(() => {
    if (inner.current) onMeasure(measureElement(inner.current).height)
  })
  return (
    <Clickable height={rows} flexShrink={0} flexDirection="column" overflow="hidden" onWheel={onWheel}>
      <Box ref={inner} flexDirection="column" flexShrink={0} marginTop={-top}>
        {children}
      </Box>
    </Clickable>
  )
}
