import { useCallback, useEffect, useState } from 'react'
import type { Account, Calendar, EventSnap, LogChange, LogEntry, LogKind } from '@shared/types'
import { isKey, type Key } from '@mysticals/core/i18n'
import { STATUS_ICON } from '@mysticals/core/logic/details'
import { errorText } from './AccountsShared'
import { Select } from './ui/Select'
import { cap, fmt, t, useLocale } from '../i18n'
import { hour12 } from '../clock'
import { timePattern } from '@mysticals/core/logic/clock'

const GROUPS = {
  all: undefined,
  actions: ['account.add', 'account.update', 'account.reauth', 'account.remove', 'calendar.visible', 'event.create', 'event.update', 'event.delete', 'event.respond'],
  sync: ['sync', 'sync.fail'],
  remote: ['remote.add', 'remote.change', 'remote.remove'],
  notify: ['notify', 'reminder']
} satisfies Record<string, LogKind[] | undefined>
type Group = keyof typeof GROUPS

const PAGE = 200
const ALL = ''
// Changed fields with a label of their own; the rest show their name.
const FIELD: Record<string, Key> = {
  title: 'logs.event',
  calendarId: 'logs.calendar',
  organizer: 'logs.organizer',
  location: 'logs.location',
  conferenceUrl: 'logs.call',
  myStatus: 'logs.myStatus',
  description: 'logs.description',
  recurrence: 'logs.series'
}

const time = (iso: string, allDay = false): string => fmt(new Date(allDay ? `${iso}T00:00:00` : iso), allDay ? 'd MMM yyyy' : `d MMM yyyy, ${timePattern(hour12())}`)
const entryKey = (e: LogEntry, i: number): string => `${e.at}|${e.kind}|${i}`
// A scope or answer read from the log file; an old or malformed one shows as it is.
const known = (group: 'scope' | 'partstat', v: string): string => {
  const key = `${group}.${v}`
  return isKey(key) ? t(key) : v
}

/** Settings > Logs: per-account history from the main process (`window.logs`), newest first, each entry expandable. */
export function LogsPanel({ accounts }: { accounts: Account[] }): React.JSX.Element {
  useLocale()
  const [account, setAccount] = useState(ALL)
  const [group, setGroup] = useState<Group>('all')
  const [entries, setEntries] = useState<LogEntry[]>()
  const [seen, setSeen] = useState<{ id: string; email: string }[]>([])
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string>()
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [error, setError] = useState('')

  const query = useCallback(
    (before?: string, limit = PAGE) => window.logs.list({ accountId: account || undefined, kinds: GROUPS[group], before, limit }),
    [account, group]
  )
  const reload = useCallback(
    (keep = PAGE) =>
      query(undefined, Math.min(Math.max(keep, PAGE), 1000)).then((p) => {
        setEntries(p.entries)
        setSeen(p.accounts)
        setMore(p.more)
        setError('')
      }, (e) => setError(errorText(e))),
    [query]
  )
  useEffect(() => void reload(), [reload])
  // New entries (a sync, an edit) arrive while the tab is open: re-read as many as are shown.
  const shown = entries?.length ?? 0
  useEffect(() => window.logs.onAppended(() => void reload(shown)), [reload, shown])
  useEffect(() => void window.api.calendars.list().then(setCalendars, () => {}), [])

  const loadMore = (): void => {
    const last = entries?.[entries.length - 1]
    if (!last) return
    query(last.at).then((p) => {
      setEntries((e) => [...(e ?? []), ...p.entries])
      setMore(p.more)
    }, (e) => setError(errorText(e)))
  }

  const current = new Set(accounts.map((a) => a.id))
  const removed = seen.filter((s) => !current.has(s.id))
  const list = [
    ...accounts.map((a) => ({ id: a.id, name: a.label, sub: a.email, color: a.color })),
    ...removed.map((s) => ({ id: s.id, name: s.email, sub: t('logs.removed'), color: 'var(--muted)' }))
  ]
  const calName = (e: LogEntry, id: string): string => calendars.find((c) => c.accountId === e.accountId && c.id === id)?.name ?? id
  const emailOf = (e: LogEntry): string => accounts.find((a) => a.id === e.accountId)?.email ?? e.email

  let lastDay = ''
  return (
    <div className="acc-panel log-panel">
      <p className="acc-note">{t('logs.note')}</p>
      <div className="acc-md">
        <div className="acc-md-list">
          <h3 className="set-heading">{t('logs.accounts')}</h3>
          <ul aria-label={t('logs.accounts')}>
            {[{ id: ALL, name: t('logs.all'), sub: '', color: '' }, ...list].map((a) => (
              <li key={a.id || 'all'}>
                <button
                  type="button"
                  className="acc-md-item"
                  aria-current={a.id === account ? 'true' : undefined}
                  data-testid={`log-account-${a.id || 'all'}`}
                  onClick={() => setAccount(a.id)}
                >
                  {a.color && <span className="acc-dot" style={{ background: a.color }} />}
                  <span className="acc-md-name">
                    <span>{a.name}</span>
                    {a.sub && <span className="acc-md-sub">{a.sub}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="acc-md-foot">
            <button type="button" data-testid="logs-open" onClick={() => window.logs.openFolder().catch((e) => setError(errorText(e)))}>
              {t('logs.open')}
            </button>
          </div>
        </div>
        <div className="acc-md-detail log-detail">
          <div className="log-toolbar">
            <span>{t('logs.filter')}</span>
            <Select
              compact
              data-testid="logs-filter"
              aria-label={t('logs.filter')}
              value={group}
              options={(Object.keys(GROUPS) as Group[]).map((g) => ({ value: g, label: t(`logs.group.${g}` as Key) }))}
              onChange={setGroup}
            />
          </div>
          {error && <p className="acc-error" role="alert">{error}</p>}
          {entries && !entries.length && <p className="acc-note">{t('logs.empty')}</p>}
          <ol className="log-list" data-testid="log-list">
            {entries?.map((e, i) => {
              const key = entryKey(e, i)
              const day = cap(fmt(new Date(e.at), 'EEEE, d MMMM yyyy'))
              const head = day !== lastDay
              lastDay = day
              const expanded = open === key
              return (
                <li key={key}>
                  {head && <h4 className="set-heading log-day">{day}</h4>}
                  <button
                    type="button"
                    className={`log-row${e.ok ? '' : ' is-err'}`}
                    aria-expanded={expanded}
                    data-testid="log-entry"
                    data-kind={e.kind}
                    onClick={() => setOpen(expanded ? undefined : key)}
                  >
                    <span className="log-time">{fmt(new Date(e.at), hour12() ? 'h:mm:ss a' : 'HH:mm:ss')}</span>
                    <span className="log-kind">
                      {t(`logs.kind.${e.kind}` as Key)}
                      {!e.ok && <b> · {t('logs.failed')}</b>}
                    </span>
                    <span className="log-summary">
                      {summary(e)}
                      {!account && e.accountId && <span className="acc-md-sub"> · {emailOf(e)}</span>}
                    </span>
                  </button>
                  {expanded && <Details e={e} email={emailOf(e)} calName={(id) => calName(e, id)} />}
                </li>
              )
            })}
          </ol>
          {more && (
            <button type="button" className="log-more" data-testid="logs-more" onClick={loadMore}>
              {t('logs.more')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** One line for the row: the event's title, else the error, else the most telling detail. */
function summary(e: LogEntry): string {
  const n = e.instances && e.instances > 1 ? ` (${t('logs.instances', { n: e.instances })})` : ''
  if (e.event) return `${e.event.title || t('common.untitled')}${n}`
  if (e.error) return e.error
  if (e.kind === 'sync' && e.detail) {
    const d = e.detail
    return d.first ? `${d.calendars} · ${d.events}` : `+${d.added ?? 0} ~${d.changed ?? 0} −${d.removed ?? 0}`
  }
  const c = e.changes?.[0]
  if (c) return `${c.from ?? '—'} → ${c.to ?? '—'}`
  if (e.detail?.calendar !== undefined) return String(e.detail.calendar)
  if (e.detail?.label !== undefined) return String(e.detail.label)
  return ''
}

function Details({ e, email, calName }: { e: LogEntry; email: string; calName: (id: string) => string }): React.JSX.Element {
  const ev = e.event
  return (
    <dl className="log-details" data-testid="log-details">
      <dt>{t('logs.account')}</dt>
      <dd>{email || '—'}</dd>
      {e.error && (
        <>
          <dt>{t('logs.error')}</dt>
          <dd className="log-error">{e.error}</dd>
        </>
      )}
      {ev && <EventRows ev={ev} calName={calName} />}
      {e.scope && (
        <>
          <dt>{t('logs.scope')}</dt>
          <dd>{known('scope', e.scope)}</dd>
        </>
      )}
      {e.status && (
        <>
          <dt>{t('logs.answer')}</dt>
          <dd>{known('partstat', e.status)}</dd>
        </>
      )}
      {!!e.changes?.length && (
        <>
          <dt>{t('logs.changes')}</dt>
          <dd>
            <table className="log-changes">
              <tbody>
                {e.changes.map((c) => (
                  <tr key={c.field}>
                    <th scope="row">{fieldName(c.field)}</th>
                    <td>{value(c, c.from, ev?.allDay)}</td>
                    <td aria-hidden>→</td>
                    <td>{value(c, c.to, ev?.allDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </dd>
        </>
      )}
      {e.detail && (
        <>
          <dt>{t('logs.details')}</dt>
          <dd className="log-mono">
            {Object.entries(e.detail)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' · ')}
          </dd>
        </>
      )}
    </dl>
  )
}

function EventRows({ ev, calName }: { ev: EventSnap; calName: (id: string) => string }): React.JSX.Element {
  const rows: [Key, React.ReactNode][] = [
    ['logs.event', ev.title || t('common.untitled')],
    ['logs.when', `${time(ev.start, ev.allDay)} – ${time(ev.end, ev.allDay)}`],
    ['logs.calendar', calName(ev.calendarId)]
  ]
  if (ev.organizer) rows.push(['logs.organizer', ev.organizer.name ? `${ev.organizer.name} <${ev.organizer.email}>` : ev.organizer.email])
  if (ev.location) rows.push(['logs.location', ev.location])
  if (ev.conferenceUrl) rows.push(['logs.call', ev.conferenceUrl])
  if (ev.myStatus) rows.push(['logs.myStatus', `${STATUS_ICON[ev.myStatus]} ${known('partstat', ev.myStatus)}`])
  if (ev.recurringEventId) rows.push(['logs.series', ev.recurringEventId])
  if (ev.attendees.length)
    rows.push([
      'logs.attendees',
      <ul className="log-people" key="people">
        {ev.attendees.map((a) => (
          <li key={a.email}>
            <span className={`log-rsvp is-${a.status}`} title={known('partstat', a.status)}>
              {STATUS_ICON[a.status]}
            </span>{' '}
            {a.name ? `${a.name} <${a.email}>` : a.email}
            {a.organizer && ` · ${t('logs.organizer').toLowerCase()}`}
          </li>
        ))}
      </ul>
    ])
  if (ev.description) rows.push(['logs.description', <span className="log-pre" key="d">{ev.description}</span>])
  return (
    <>
      {rows.map(([k, v]) => (
        <Row key={k} label={t(k)}>
          {v}
        </Row>
      ))}
    </>
  )
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
)

function fieldName(field: string): string {
  if (field.startsWith('attendee:')) return `${t('logs.attendees')}: ${field.slice(9)}`
  return FIELD[field] ? t(FIELD[field]) : field
}

function value(c: LogChange, v: string | undefined, allDay = false): string {
  if (v === undefined) return '—'
  if ((c.field === 'start' || c.field === 'end') && !Number.isNaN(Date.parse(v))) return time(v, allDay)
  if (c.field === 'myStatus' || c.field.startsWith('attendee:')) return known('partstat', v)
  return v
}
