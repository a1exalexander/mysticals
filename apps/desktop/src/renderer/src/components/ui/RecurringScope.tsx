import type { DeleteScope } from '@shared/types'
import type { Key } from '@mysticals/core/i18n'
import { t } from '../../i18n'

const SCOPES: [DeleteScope, Key][] = [['one', 'scope.one'], ['following', 'scope.following'], ['all', 'scope.all']]

const Icon = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <svg className="mc-scope-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

/** How much of the series a choice takes: one day of it, from this one on, or the whole repeating loop. */
const SCOPE_ICON: Record<DeleteScope, React.JSX.Element> = {
  one: (
    <Icon>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16M8.5 3v4M15.5 3v4" />
      <rect x="10" y="12.5" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
    </Icon>
  ),
  following: (
    <Icon>
      <path d="M5 5v14" />
      <path d="M9 12h11M16 8l4 4-4 4" />
    </Icon>
  ),
  all: (
    <Icon>
      <path d="M4 11a8 8 0 0 1 14.5-4.5M20 13a8 8 0 0 1-14.5 4.5" />
      <path d="M19 3v4h-4M5 21v-4h4" />
    </Icon>
  )
}
const CancelIcon = (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

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
          {SCOPE_ICON[scope]}
          {t(label)}
        </button>
      ))}
      <button type="button" className="mc-btn" onClick={onCancel}>
        {CancelIcon}
        {t('common.cancel')}
      </button>
    </div>
  )
}
