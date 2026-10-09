import { useState } from 'react'
import type { Recurrence } from '@shared/types'
import {
  describe, FREQS, presetOf, presets, shortDay, weekdayOf, withEnd, WEEKDAYS, type PresetId
} from '@mysticals/core/logic/recurrence'
import { DateTimeField } from './DateTimeField'
import { NumberField } from './NumberField'
import { Select } from './Select'
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
        <label htmlFor="ed-repeat">{t('repeat.label')}</label>
        {/* <output>: a status a label can point at. */}
        <output id="ed-repeat" className="editor-static editor-muted" data-testid="editor-repeat">
          {status === 'loading' ? t('repeat.loading') : t('repeat.loadFailed')}
        </output>
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
      <label htmlFor="ed-repeat">{t('repeat.label')}</label>
      <Select
        id="ed-repeat"
        data-testid="editor-repeat"
        aria-label={t('repeat.label')}
        value={showCustom ? 'custom' : preset}
        options={[
          ...presets(start, locale).map((p) => ({ value: p.id, label: p.label })),
          { value: 'custom', label: preset === 'custom' && value ? describe(value, start, locale) : t('repeat.customOption') },
          ...(preset === 'rule' && value ? [{ value: 'rule', label: describe(value, start, locale) }] : [])
        ]}
        onChange={pick}
      />

      {showCustom && value && (
        <>
          <label htmlFor="ed-repeat-every">{t('repeat.every')}</label>
          <div className="editor-repeat-row">
            <NumberField id="ed-repeat-every" aria-label={t('repeat.everyAria')} value={value.interval ?? 1} onChange={(interval) => set({ interval })} />
            <Select
              compact
              aria-label={t('repeat.unitAria')}
              value={value.freq}
              options={FREQS.map((f) => ({ value: f, label: t(`repeat.unit.${f}`, { n: value.interval ?? 1 }) }))}
              onChange={(freq) => set({ freq, byDay: undefined })}
            />
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
          <label htmlFor="ed-repeat-stops">{t('repeat.stops')}</label>
          <div className="editor-repeat-row">
            <Select
              id="ed-repeat-stops"
              compact
              aria-label={t('repeat.stopsAria')}
              value={ends}
              options={[
                { value: 'never', label: t('repeat.never') },
                { value: 'until', label: t('repeat.endOnDate') },
                { value: 'count', label: t('repeat.after') }
              ]}
              onChange={(v) =>
                onChange({
                  ...value,
                  until: v === 'until' ? (value.until ?? start.slice(0, 10)) : undefined,
                  count: v === 'count' ? (value.count ?? 10) : undefined
                })
              }
            />
            {ends === 'until' && (
              <DateTimeField label={t('repeat.stopsOn')} dateOnly value={`${value.until}T00:00`} onChange={(v) => set({ until: v.slice(0, 10) })} />
            )}
            {ends === 'count' && (
              <>
                <NumberField aria-label={t('repeat.occurrences')} value={value.count ?? 1} onChange={(count) => set({ count })} />
                <span className="editor-muted">{t('repeat.times', { n: value.count ?? 1 })}</span>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
