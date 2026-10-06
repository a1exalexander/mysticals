import { useRef, useState } from 'react'
import { keyStep, pct, snap, valueFromPointer } from './Range.logic'
import './Range.css'

interface Props {
  value: number
  min: number
  max: number
  step: number
  /** How far PageUp/PageDown move; defaults to ten steps. */
  bigStep?: number
  onChange: (v: number) => void
  /** The value as read out, and in the tick labels. */
  format: (v: number) => string
  /** Values labelled under the track. */
  ticks?: number[]
  disabled?: boolean
  'aria-label'?: string
  'data-testid'?: string
}

/** A draggable slider: click or drag the track, or use the arrow, Page, Home and End keys on the thumb. */
export function Range({ value, min, max, step, bigStep = step * 10, onChange, format, ticks, disabled, ...rest }: Props): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const v = snap(value, min, max, step)
  const set = (next: number): void => {
    if (next !== v) onChange(next)
  }
  const at = (x: number): number => {
    const r = track.current!.getBoundingClientRect()
    return valueFromPointer(x, r.left, r.width, min, max, step)
  }

  return (
    <div className={`mrange${disabled ? ' is-disabled' : ''}${dragging ? ' is-dragging' : ''}`}>
      <div
        ref={track}
        className="mrange-track"
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          thumb.current?.focus()
          set(at(e.clientX))
        }}
        onPointerMove={(e) => {
          if (dragging) set(at(e.clientX))
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="mrange-rail" />
        <div className="mrange-fill" style={{ width: `${pct(v, min, max)}%` }} />
        <div
          ref={thumb}
          className="mrange-thumb"
          style={{ left: `${pct(v, min, max)}%` }}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={v}
          aria-valuetext={format(v)}
          aria-disabled={disabled || undefined}
          aria-orientation="horizontal"
          aria-label={rest['aria-label']}
          data-testid={rest['data-testid']}
          onKeyDown={(e) => {
            if (disabled) return
            const next = keyStep(e.key, v, min, max, step, bigStep)
            if (next === null) return
            e.preventDefault()
            set(next)
          }}
        />
      </div>
      {ticks && (
        <div className="mrange-ticks" aria-hidden>
          {ticks.map((n) => (
            <span key={n} className={n === v ? 'on' : ''} style={{ left: `${pct(n, min, max)}%` }}>
              {format(n)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
