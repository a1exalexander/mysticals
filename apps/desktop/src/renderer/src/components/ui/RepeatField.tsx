import { useState } from 'react'
import type { Recurrence } from '@shared/types'
import {
  describe, FREQS, presetOf, presets, shortDay, weekdayOf, withEnd, WEEKDAYS, type PresetId
} from '@mysticals/core/logic/recurrence'
import { DateTimeField } from './DateTimeField'
import { currentLocale, t } from '../../i18n'

type Ends = 'never' | 'until' | 'count'

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
  const locale = currentLocale()

  if (status) {
    return (
      <>
        <label>{t('repeat.label')}</label>
        <div className="editor-static editor-muted" data-testid="editor-repeat">
          {status === 'loading' ? t('repeat.loading') : t('repeat.loadFailed')}
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
    const p = presets(start, locale).find((x) => x.id === id)
    if (p) onChange(p.recurrence && withEnd(p.recurrence, value))
  }
  const set = (patch: Partial<Recurrence>): void => {
    if (value) onChange({ ...value, ...patch })
  }
  const days = value?.byDay?.length ? value.byDay : [weekdayOf(start)]

  return (
    <>
      <label>{t('repeat.label')}</label>
      <select data-testid="editor-repeat" value={showCustom ? 'custom' : preset} onChange={(e) => pick(e.target.value)}>
        {presets(start, locale).map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
        <option value="custom">{preset === 'custom' && value ? describe(value, start, locale) : t('repeat.customOption')}</option>
        {preset === 'rule' && value && <option value="rule">{describe(value, start, locale)}</option>}
      </select>

      {showCustom && value && (
        <>
          <label>{t('repeat.every')}</label>
          <div className="editor-repeat-row">
            <input
              type="number"
              min={1}
              max={999}
              aria-label={t('repeat.everyAria')}
              value={value.interval ?? 1}
              onChange={(e) => set({ interval: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })}
            />
            <select aria-label={t('repeat.unitAria')} value={value.freq} onChange={(e) => set({ freq: e.target.value as Recurrence['freq'], byDay: undefined })}>
              {FREQS.map((f) => (
                <option key={f} value={f}>{t(`repeat.unit.${f}`, { n: value.interval ?? 1 })}</option>
              ))}
            </select>
          </div>
          {value.freq === 'weekly' && (
            <>
              <label>{t('repeat.on')}</label>
              <div className="editor-days" role="group" aria-label={t('repeat.onAria')}>
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
                      {shortDay(d, locale).slice(0, 2)}
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
          <label>{t('repeat.stops')}</label>
          <div className="editor-repeat-row">
            <select
              aria-label={t('repeat.stopsAria')}
              value={ends}
              onChange={(e) => {
                const v = e.target.value as Ends
                onChange({
                  ...value,
                  until: v === 'until' ? (value.until ?? start.slice(0, 10)) : undefined,
                  count: v === 'count' ? (value.count ?? 10) : undefined
                })
              }}
            >
              <option value="never">{t('repeat.never')}</option>
              <option value="until">{t('repeat.endOnDate')}</option>
              <option value="count">{t('repeat.after')}</option>
            </select>
            {ends === 'until' && (
              <DateTimeField label={t('repeat.stopsOn')} dateOnly value={`${value.until}T00:00`} onChange={(v) => set({ until: v.slice(0, 10) })} />
            )}
            {ends === 'count' && (
              <>
                <input
                  type="number"
                  min={1}
                  max={999}
                  aria-label={t('repeat.occurrences')}
                  value={value.count}
                  onChange={(e) => set({ count: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })}
                />
                <span className="editor-muted">{t('repeat.times', { n: value.count ?? 1 })}</span>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
