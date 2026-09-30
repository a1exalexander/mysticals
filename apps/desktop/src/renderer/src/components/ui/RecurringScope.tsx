import type { DeleteScope } from '@shared/types'

const SCOPES: [DeleteScope, string][] = [['one', 'This event'], ['following', 'This and following'], ['all', 'All events']]

/** "This event / This and following / All events" choice for a change to a recurring event. */
export function RecurringScope({
  title,
  scopes,
  danger,
  busy,
  onPick,
  onCancel
}: {
  title: string
  /** The choices offered (default all three). */
  scopes?: DeleteScope[]
  danger?: boolean
  busy?: boolean
  onPick: (scope: DeleteScope) => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="mc-actions mc-scope" role="group" aria-label={title}>
      <span>{title}</span>
      {SCOPES.filter(([scope]) => !scopes || scopes.includes(scope)).map(([scope, label]) => (
        <button key={scope} type="button" className={danger ? 'mc-btn danger' : 'mc-btn'} disabled={busy} onClick={() => onPick(scope)}>
          {label}
        </button>
      ))}
      <button type="button" className="mc-btn" onClick={onCancel}>Cancel</button>
    </div>
  )
}
