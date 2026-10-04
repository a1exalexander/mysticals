import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * A fixed popover anchored to `anchor` (the trigger's rect when it opened): below it, or above when it
 * would overflow, kept inside the window. Closes on an outside mousedown, Esc, an outside scroll and resize.
 * Returns the popover's style: hidden until it's measured.
 */
export function usePopover(
  anchor: DOMRect | null,
  root: RefObject<HTMLElement | null>,
  pop: RefObject<HTMLElement | null>,
  close: () => void
): React.CSSProperties {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const onClose = useRef(close)
  onClose.current = close

  useLayoutEffect(() => {
    setPos(null)
    if (!anchor || !pop.current) return
    const { width, height } = pop.current.getBoundingClientRect()
    const below = anchor.bottom + 4
    const top = below + height <= innerHeight - 8 ? below : Math.max(8, anchor.top - height - 4)
    setPos({ left: Math.max(8, Math.min(anchor.left, innerWidth - width - 8)), top })
  }, [anchor, pop])

  useEffect(() => {
    if (!anchor) return
    const done = (): void => onClose.current()
    const onDown = (e: MouseEvent): void => {
      // The trigger toggles on its own click.
      if (!root.current?.contains(e.target as Node)) done()
    }
    // Capture + stop so Esc closes only the popover, not the sheet behind it.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      done()
    }
    const onScroll = (e: Event): void => {
      if (!pop.current?.contains(e.target as Node)) done()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', done)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', done)
    }
  }, [anchor, root, pop])

  return pos ?? { visibility: 'hidden', left: 0, top: 0 }
}
