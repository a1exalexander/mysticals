import type { DeleteScope } from '@shared/types'
import type { Key } from '@mysticals/core/i18n'
import { t } from '../../i18n'

const SCOPES: [DeleteScope, Key][] = [['one', 'scope.one'], ['following', 'scope.following'], ['all', 'scope.all']]

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
          {t(label)}
        </button>
      ))}
      <button type="button" className="mc-btn" onClick={onCancel}>{t('common.cancel')}</button>
    </div>
  )
}
