import { useId, useLayoutEffect, useRef, useState } from 'react'
import { edge, step, typeahead } from './Select.logic'
import { usePopover } from './usePopover'
import './ui.css'
import './Select.css'

export type SelectOption<T extends string = string> = {
  value: T
  label: string
  /** Muted secondary text, e.g. an account's email. */
  hint?: string
  /** A colour swatch before the label (accounts, calendars). */
  color?: string
  disabled?: boolean
}

type Props<T extends string> = {
  value: T | ''
  options: SelectOption<T>[]
  onChange: (v: T) => void
  /** Shown while no option matches `value`. */
  placeholder?: string
  disabled?: boolean
  /** Size to the content instead of filling the row. */
  compact?: boolean
  /** The trigger's id, for a <label htmlFor>. */
  id?: string
  'aria-label'?: string
  'data-testid'?: string
}

// A themed listbox in place of a native <select>: the trigger keeps focus, arrows/Home/End/letters move the
// highlighted option, Enter/Space picks it, Esc/Tab close.
export function Select<T extends string>({ value, options, onChange, placeholder, disabled, compact, id: triggerId, ...rest }: Props<T>): React.JSX.Element {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [active, setActive] = useState(-1)
  const typed = useRef({ text: '', at: 0 })
  const root = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const id = useId()
  const selected = options.findIndex((o) => o.value === value)
  const current = options[selected]

  const close = (): void => setAnchor(null)
  const open = (from = selected): void => {
    if (disabled || !root.current) return
    setActive(from >= 0 && !options[from]?.disabled ? from : edge(options, 1))
    setAnchor(root.current.getBoundingClientRect())
  }
  const pick = (i: number): void => {
    const o = options[i]
    if (!o || o.disabled) return
    close()
    if (o.value !== value) onChange(o.value)
  }
  const style = usePopover(anchor, root, pop, close)

  useLayoutEffect(() => {
    if (anchor) pop.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [anchor, active])

  const onKey = (e: React.KeyboardEvent): void => {
    const k = e.key
    if (k === 'Tab') return close()
    if (k.length === 1 && k !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Letters within a short pause build one prefix, like a native select.
      const now = Date.now()
      typed.current = { text: now - typed.current.at < 700 ? typed.current.text + k : k, at: now }
      const from = anchor ? active : selected
      // A longer prefix may still match the current item; a single letter moves on.
      const hit = typeahead(options, typed.current.text.length > 1 ? Math.max(from, 0) - 1 : from, typed.current.text)
      if (hit < 0) return
      if (anchor) setActive(hit)
      else open(hit)
      return
    }
    const nav: Record<string, () => void> = anchor
      ? {
          ArrowDown: () => setActive(step(options, active, 1)),
          ArrowUp: () => setActive(step(options, active, -1)),
          Home: () => setActive(edge(options, 1)),
          End: () => setActive(edge(options, -1)),
          Enter: () => pick(active),
          ' ': () => pick(active)
        }
      : { ArrowDown: () => open(), ArrowUp: () => open(), Enter: () => open(), ' ': () => open() }
    if (!nav[k]) return
    e.preventDefault()
    nav[k]()
  }

  return (
    <div className={compact ? 'msel compact' : 'msel'} ref={root}>
      <button
        type="button"
        id={triggerId}
        role="combobox"
        className="msel-trigger"
        aria-haspopup="listbox"
        aria-expanded={!!anchor}
        aria-controls={anchor ? id : undefined}
        aria-activedescendant={anchor && active >= 0 ? `${id}-${active}` : undefined}
        aria-label={rest['aria-label']}
        data-testid={rest['data-testid']}
        data-value={value}
        disabled={disabled}
        onClick={() => (anchor ? close() : open())}
        onKeyDown={onKey}
      >
        {current ? (
          <>
            {current.color && <span className="msel-swatch" style={{ background: current.color }} />}
            <span className="msel-label">{current.label}</span>
            {current.hint && <span className="msel-hint">{current.hint}</span>}
          </>
        ) : (
          <span className="msel-label msel-placeholder">{placeholder ?? ''}</span>
        )}
        <svg className="msel-chevron" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {anchor && (
        <div
          ref={pop}
          id={id}
          role="listbox"
          className="msel-pop"
          style={{ ...style, minWidth: anchor.width }}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-${i}`}
              data-index={i}
              data-value={o.value}
              role="option"
              aria-selected={i === selected}
              aria-disabled={o.disabled || undefined}
              className={i === active ? 'msel-opt active' : 'msel-opt'}
              // Keep focus on the trigger.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => !o.disabled && i !== active && setActive(i)}
              onClick={() => pick(i)}
            >
              {o.color && <span className="msel-swatch" style={{ background: o.color }} />}
              <span className="msel-label">{o.label}</span>
              {o.hint && <span className="msel-hint">{o.hint}</span>}
              <svg className="msel-check" viewBox="0 0 12 10" aria-hidden="true">
                <path d="M1 5l3.5 3.5L11 1" />
              </svg>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
