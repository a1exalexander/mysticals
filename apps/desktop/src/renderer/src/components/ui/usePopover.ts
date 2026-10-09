import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Calls `on` for scrolls from the next frame on; returns the unsubscribe. Scroll events fire a frame late, so one for
 * a scroll made just before a menu or popover opened (a focus, the grid's scroll to now, a wheel) would close it at once.
 */
export function onLaterScroll(on: (e: Event) => void): () => void {
  const frame = requestAnimationFrame(() => window.addEventListener('scroll', on, true))
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', on, true)
  }
}

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
    const offScroll = onLaterScroll(onScroll)
    window.addEventListener('resize', done)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      offScroll()
      window.removeEventListener('resize', done)
    }
  }, [anchor, root, pop])

  return pos ?? { visibility: 'hidden', left: 0, top: 0 }
}

/**
 * While `open`, focus moves to `target()` (a heading with tabIndex -1, or a control). On close it goes back to what
 * had keyboard focus (:focus-visible) when it opened, like the event menu: a mouse user wants no ring, and no tooltip
 * on an event, afterwards. Pass the `opener` when known: while it's still in the page only it gets focus back, as what
 * had focus before can be unrelated (grid events don't take focus on click).
 */
export function usePopoverFocus(open: boolean, target: () => HTMLElement | null | undefined, opener?: HTMLElement): void {
  const back = useRef<Element | null>(null)
  useEffect(() => {
    if (!open) return
    const el = target()
    const was = document.activeElement
    // StrictMode runs this twice: the second time focus is already on el.
    if (was !== el) back.current = was?.matches(':focus-visible') ? was : null
    el?.focus()
    return () => {
      const to = back.current
      // Focus inside the closed popover fell back to <body>; leave it if the user put it somewhere else.
      if (document.activeElement !== document.body || !(to instanceof HTMLElement) || !to.isConnected) return
      if (opener?.isConnected && opener !== to) return
      to.focus()
    }
  }, [open, opener])
}

/**
 * Shows `dialog` as a modal while `open` (focus trap, inert background, Esc) and, once it's gone, gives focus back
 * to what had it when it opened, if that's still in the page.
 */
export function useModal(dialog: RefObject<HTMLDialogElement | null>, open: boolean): void {
  useEffect(() => {
    const d = dialog.current
    if (!open || !d || d.open) return
    const back = document.activeElement
    d.showModal()
    return () => {
      // StrictMode re-runs this while the dialog is still up: closed here, the re-run shows it again.
      if (d.open) d.close()
      if (document.activeElement === document.body && back instanceof HTMLElement && back.isConnected) back.focus()
    }
  }, [dialog, open])
}
