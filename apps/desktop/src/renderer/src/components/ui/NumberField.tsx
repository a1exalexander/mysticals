import { t } from '../../i18n'

type Props = {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  /** The input's id, for a <label htmlFor>. */
  id?: string
  'aria-label': string
}

/** A small integer field with −/+ steppers in place of the native spinners; clamps to [min, max]. */
export function NumberField({ value, onChange, min = 1, max = 999, id, ...rest }: Props): React.JSX.Element {
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n) || min))
  return (
    <div className="mnum">
      <button type="button" tabIndex={-1} aria-label={t('common.decrease')} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        −
      </button>
      <input
        id={id}
        className="mnum-input"
        inputMode="numeric"
        aria-label={rest['aria-label']}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, ''))))}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
          if (!d) return
          e.preventDefault()
          onChange(clamp(value + d))
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" tabIndex={-1} aria-label={t('common.increase')} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
        +
      </button>
    </div>
  )
}
