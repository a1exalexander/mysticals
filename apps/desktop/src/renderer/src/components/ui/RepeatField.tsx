import { useState } from 'react'
import type { Recurrence } from '@shared/types'
import {
  describe, FREQS, presetOf, presets, shortDay, weekdayOf, withEnd, WEEKDAYS, type PresetId
} from '@mysticals/core/logic/recurrence'
import { DateTimeField } from './DateTimeField'
import { NumberField } from './NumberField'
import { Select, type SelectOption } from './Select'

const UNITS: Record<Recurrence['freq'], string> = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }
type Ends = 'never' | 'until' | 'count'
const ENDS: SelectOption<Ends>[] = [
  { value: 'never', label: 'Never' },
  { value: 'until', label: 'On date' },
  { value: 'count', label: 'After' }
]

type Props = {
  value: Recurrence | null
  /** The event's start (form format), which presets and implicit days follow. */
  start: string
  /** 'loading' / 'error' while the series' rule isn't known: shown, not editable. */
  status?: 'loading' | 'error'
  onChange: (r: Recurrence | null) => void
}

/** "Repeat" rows of the editor grid: a preset or a custom rule, and when it stops. */
export function RepeatField({ value, start, status, onChange }: Props): React.JSX.Element {
  const [custom, setCustom] = useState(false)
  const preset: PresetId | 'rule' = value?.rule ? 'rule' : presetOf(value, start)
  const showCustom = !!value && !value.rule && (custom || preset === 'custom')
  const ends: Ends = value?.until ? 'until' : value?.count ? 'count' : 'never'

  if (status) {
    return (
      <>
        <label>Repeat</label>
        <div className="editor-static editor-muted" data-testid="editor-repeat">
          {status === 'loading' ? 'Loading…' : 'Couldn’t load the repeat rule; it stays as it is.'}
        </div>
      </>
    )
  }

  const pick = (id: string): void => {
    if (id === 'custom') {
      setCustom(true)
      return onChange(value && !value.rule ? value : withEnd({ freq: 'weekly' }, value))
    }
    setCustom(false)
    const p = presets(start).find((x) => x.id === id)
    if (p) onChange(p.recurrence && withEnd(p.recurrence, value))
  }
  const set = (patch: Partial<Recurrence>): void => {
    if (value) onChange({ ...value, ...patch })
  }
  const days = value?.byDay?.length ? value.byDay : [weekdayOf(start)]

  return (
    <>
      <label>Repeat</label>
      <Select
        data-testid="editor-repeat"
        aria-label="Repeat"
        value={showCustom ? 'custom' : preset}
        options={[
          ...presets(start).map((p) => ({ value: p.id, label: p.label })),
          { value: 'custom', label: preset === 'custom' && value ? describe(value, start) : 'Custom…' },
          ...(preset === 'rule' && value ? [{ value: 'rule', label: describe(value, start) }] : [])
        ]}
        onChange={pick}
      />

      {showCustom && value && (
        <>
          <label>Every</label>
          <div className="editor-repeat-row">
            <NumberField aria-label="Repeat every" value={value.interval ?? 1} onChange={(interval) => set({ interval })} />
            <Select
              compact
              aria-label="Repeat unit"
              value={value.freq}
              options={FREQS.map((f) => ({ value: f, label: UNITS[f] }))}
              onChange={(freq) => set({ freq, byDay: undefined })}
            />
          </div>
          {value.freq === 'weekly' && (
            <>
              <label>On</label>
              <div className="editor-days" role="group" aria-label="Repeat on">
                {WEEKDAYS.map((d) => {
                  const on = days.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      className={on ? 'on' : ''}
                      // At least one day stays selected.
                      onClick={() => set({ byDay: on ? (days.length > 1 ? days.filter((x) => x !== d) : days) : [...days, d] })}
                    >
                      {shortDay(d).slice(0, 2)}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {value && !value.rule && (
        <>
          <label>Stops</label>
          <div className="editor-repeat-row">
            <Select
              compact
              aria-label="Repeat stops"
              value={ends}
              options={ENDS}
              onChange={(v) =>
                onChange({
                  ...value,
                  until: v === 'until' ? (value.until ?? start.slice(0, 10)) : undefined,
                  count: v === 'count' ? (value.count ?? 10) : undefined
                })
              }
            />
            {ends === 'until' && (
              <DateTimeField label="Stops on" dateOnly value={`${value.until}T00:00`} onChange={(v) => set({ until: v.slice(0, 10) })} />
            )}
            {ends === 'count' && (
              <>
                <NumberField aria-label="Occurrences" value={value.count ?? 1} onChange={(count) => set({ count })} />
                <span className="editor-muted">times</span>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
