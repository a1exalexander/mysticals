import { useLayoutEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { format } from 'date-fns'
import { WEEK_STARTS_ON } from '@mysticals/core/logic/layout'
import 'react-day-picker/style.css'
import { usePopover } from './usePopover'
import './DateTimeField.css'
import { dateLocale, fmt, t } from '../../i18n'

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
  /** The date trigger's id, for a <label htmlFor>. */
  id?: string
}

// Date + time triggers, each opening a small themed popover. Replaces native datetime inputs.
export function DateTimeField({ value, onChange, dateOnly, label, id }: Props): React.JSX.Element {
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
  const setTime = (hhmm: string): void => {
    onChange(`${date}T${hhmm}`)
    setOpen(null)
  }

  const style = usePopover(open?.rect ?? null, root, pop, () => setOpen(null))
  useLayoutEffect(() => {
    if (open?.kind === 'time') pop.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <div className="dtf" ref={root}>
      <button
        id={id}
        type="button"
        className="dtf-trigger"
        aria-label={t('dtf.date', { label })}
        aria-expanded={open?.kind === 'date'}
        onClick={(e) => toggle('date', e.currentTarget)}
      >
        {fmt(day, 'EEE, d MMM yyyy')}
      </button>
      {!dateOnly && (
        <button
          type="button"
          className="dtf-trigger dtf-time"
          aria-label={t('dtf.time', { label })}
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
          aria-label={t(open.kind === 'date' ? 'dtf.date' : 'dtf.time', { label })}
          style={style}
        >
          {open.kind === 'date' ? (
            <DayPicker
              mode="single"
              required
              autoFocus
              showOutsideDays
              weekStartsOn={WEEK_STARTS_ON}
              locale={dateLocale()}
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
                aria-label={t('dtf.typed', { label })}
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return
                  e.preventDefault()
                  const hhmm = parseTime(typed)
                  if (hhmm) setTime(hhmm)
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
