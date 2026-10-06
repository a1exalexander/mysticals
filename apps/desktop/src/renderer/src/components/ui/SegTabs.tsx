import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface SegTab<T extends string> {
  id: T
  label: string
}

interface Props<T extends string> {
  tabs: readonly SegTab<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel?: string
  className?: string
  testId?: (id: T) => string
  /** Tab element id, for a panel's aria-labelledby. */
  tabId?: (id: T) => string
  /** Id of the tabpanel the tabs control. */
  controls?: string
  /** Arrow keys / Home / End move the selection (roving tabindex). Off where the arrows already mean something else. */
  arrowKeys?: boolean
  /** Vertical: tabs stacked top to bottom (Settings sidebar); Up/Down move too. Layout itself is the caller's CSS. */
  orientation?: 'horizontal' | 'vertical'
}

/**
 * Segmented tabs on a tinted track; one thumb slides (spring easing, see .seg-thumb in base.css) under the active
 * tab.
 */
export function SegTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
  testId,
  tabId,
  controls,
  arrowKeys = true,
  orientation = 'horizontal'
}: Props<T>): React.JSX.Element {
  const btns = useRef(new Map<T, HTMLButtonElement>())
  const thumb = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const b = btns.current.get(value)
    const t = thumb.current
    if (!b || !t) return
    const place = (): void => {
      if (orientation === 'vertical') {
        // Follows the tab on both axes: narrow sheets lay the same tabs out in a row.
        t.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`
        t.style.height = `${b.offsetHeight}px`
      } else t.style.transform = `translateX(${b.offsetLeft}px)`
      t.style.width = `${b.offsetWidth}px`
    }
    place()
    // Any tab can resize (narrow toolbar padding, another language): follow the active one.
    const ro = new ResizeObserver(place)
    btns.current.forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [value, orientation])
  // Only animate moves after the first placement, so the thumb doesn't fly in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const i = tabs.findIndex((t) => t.id === value)
    const n = tabs.length
    const fwd = e.key === 'ArrowRight' || (orientation === 'vertical' && e.key === 'ArrowDown')
    const back = e.key === 'ArrowLeft' || (orientation === 'vertical' && e.key === 'ArrowUp')
    const next =
      fwd
        ? (i + 1) % n
        : back
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1
    if (next < 0) return
    e.preventDefault()
    onChange(tabs[next].id)
    btns.current.get(tabs[next].id)?.focus()
  }

  return (
    <div
      className={['seg', orientation === 'vertical' && 'seg-vertical', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
      data-ready={ready}
      onKeyDown={arrowKeys ? onKey : undefined}
    >
      <span className="seg-thumb" ref={thumb} aria-hidden />
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => void (el ? btns.current.set(t.id, el) : btns.current.delete(t.id))}
          type="button"
          role="tab"
          id={tabId?.(t.id)}
          aria-selected={t.id === value}
          aria-controls={controls}
          tabIndex={!arrowKeys || t.id === value ? 0 : -1}
          className={t.id === value ? 'active' : undefined}
          data-testid={testId?.(t.id)}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
