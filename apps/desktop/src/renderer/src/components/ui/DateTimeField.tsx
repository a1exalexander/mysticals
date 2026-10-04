import { useLayoutEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { format } from 'date-fns'
import { WEEK_STARTS_ON } from '@mysticals/core/logic/layout'
import 'react-day-picker/style.css'
import { usePopover } from './usePopover'
import './DateTimeField.css'

const SLOTS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
const HHMM = /^([01]?\d|2[0-3]):?([0-5]\d)$/

/** 'H:mm', 'HH:mm' or 'HHmm' → 'HH:mm'; null when not a time. */
function parseTime(s: string): string | null {
  const m = HHMM.exec(s.trim())
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

type Props = {
  /** Local 'YYYY-MM-DDTHH:mm' (the editor's form format). */
  value: string
  onChange: (v: string) => void
  /** Hide the time part (all-day events). */
  dateOnly?: boolean
  /** Accessible name prefix, e.g. 'Starts'. */
  label: string
}

// Date + time triggers, each opening a small themed popover. Replaces native datetime inputs.
export function DateTimeField({ value, onChange, dateOnly, label }: Props): React.JSX.Element {
  const [open, setOpen] = useState<{ kind: 'date' | 'time'; rect: DOMRect } | null>(null)
  const [typed, setTyped] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const date = value.slice(0, 10)
  const time = value.slice(11, 16)
  const day = new Date(`${date}T00:00`)

  const toggle = (kind: 'date' | 'time', el: HTMLElement): void => {
    setTyped(time)
    setOpen(open?.kind === kind ? null : { kind, rect: el.getBoundingClientRect() })
  }
  const setTime = (t: string): void => {
    onChange(`${date}T${t}`)
    setOpen(null)
  }

  const style = usePopover(open?.rect ?? null, root, pop, () => setOpen(null))
  useLayoutEffect(() => {
    if (open?.kind === 'time') pop.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <div className="dtf" ref={root}>
      <button
        type="button"
        className="dtf-trigger"
        aria-label={`${label} date`}
        aria-expanded={open?.kind === 'date'}
        onClick={(e) => toggle('date', e.currentTarget)}
      >
        {format(day, 'EEE, d MMM yyyy')}
      </button>
      {!dateOnly && (
        <button
          type="button"
          className="dtf-trigger dtf-time"
          aria-label={`${label} time`}
          aria-expanded={open?.kind === 'time'}
          onClick={(e) => toggle('time', e.currentTarget)}
        >
          {time}
        </button>
      )}
      {open && (
        <div
          ref={pop}
          className={`dtf-pop dtf-pop-${open.kind}`}
          role="dialog"
          aria-label={`${label} ${open.kind}`}
          style={style}
        >
          {open.kind === 'date' ? (
            <DayPicker
              mode="single"
              required
              autoFocus
              showOutsideDays
              weekStartsOn={WEEK_STARTS_ON}
              defaultMonth={day}
              selected={day}
              onSelect={(d) => {
                onChange(`${format(d, 'yyyy-MM-dd')}${value.slice(10)}`)
                setOpen(null)
              }}
            />
          ) : (
            <>
              <input
                className="dtf-typed"
                aria-label={`${label} time, HH:mm`}
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return
                  e.preventDefault()
                  const t = parseTime(typed)
                  if (t) setTime(t)
                }}
              />
              <div className="dtf-slots" role="listbox">
                {SLOTS.map((s) => (
                  <button key={s} type="button" role="option" aria-selected={s === time} onClick={() => setTime(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
