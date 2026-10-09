import { useEffect, useRef, useState } from 'react'
import type { CalEvent, DeleteScope } from '@shared/types'
import { bus, type BusEvents } from '../bus'
import { useDirectory } from './ui/useDirectory'
import { DateTimeField } from './ui/DateTimeField'
import { RecurringScope } from './ui/RecurringScope'
import { RepeatField } from './ui/RepeatField'
import { Select } from './ui/Select'
import { extraEmail } from '@mysticals/core/logic/details'
import {
  applyForm, emptyForm, setAllDay, errorText, formFromEvent, formToInput, isEmail, moveStart, repeatChanged, soleId, splitEmails,
  withLoadedRepeat, writableAccounts, writableCalendars, type EventForm
} from '@mysticals/core/logic/editor'
import './ui/ui.css'
import './EventEditor.css'
import { currentLocale, t, useLocale } from '../i18n'

type Opened = { mode: 'create'; prefill: BusEvents['event:create'] } | { mode: 'edit'; event: CalEvent }

// Create/edit sheet. Account + calendar are an explicit choice; editing never moves an event between accounts.
export function EventEditorHost(): React.JSX.Element | null {
  const { accounts, calendars, loaded } = useDirectory()
  useLocale()
  const [opened, setOpened] = useState<Opened | null>(null)
  const [form, setForm] = useState<EventForm | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Saving a recurring event first asks which part of the series the edit is for.
  const [askScope, setAskScope] = useState(false)
  const [repeatFailed, setRepeatFailed] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const session = useRef(0) // bumps on every open/close so a late save can't touch a newer editor

  useEffect(() => {
    const open = (o: Opened): void => {
      session.current++
      setSaving(false)
      setAskScope(false)
      setRepeatFailed(false)
      setOpened(o)
      setForm(null)
      setDraft('')
      setError('')
    }
    const offs = [
      bus.on('event:create', (prefill) => open({ mode: 'create', prefill })),
      bus.on('event:edit', ({ event }) => open({ mode: 'edit', event })),
      window.api.onMenu((cmd) => cmd === 'new-event' && open({ mode: 'create', prefill: {} }))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!opened || form || !loaded) return
    setForm(opened.mode === 'edit' ? formFromEvent(opened.event) : emptyForm(accounts, calendars, opened.prefill))
    requestAnimationFrame(() => titleRef.current?.focus())
    // A series' rule isn't cached: read it from the provider; until then the rule can't be changed.
    if (opened.mode === 'edit' && opened.event.recurringEventId) {
      const mine = session.current
      window.api.events.recurrence(opened.event).then(
        (rule) => session.current === mine && setForm((f) => f && withLoadedRepeat(f, rule)),
        () => session.current === mine && setRepeatFailed(true)
      )
    }
  }, [opened, form, loaded, accounts, calendars])

  const close = (): void => {
    session.current++
    setOpened(null)
    setForm(null)
  }

  const editing = opened?.mode === 'edit' ? opened.event : null
  const account = accounts.find((a) => a.id === form?.accountId)
  const choices = writableAccounts(accounts, calendars)
  const accountCals = form ? writableCalendars(calendars, form.accountId) : []
  const pendingEmails = splitEmails(draft)
  const invitees = form ? [...form.attendees, ...pendingEmails] : []
  const canSave = !!form && !!form.accountId && !!form.calendarId && !saving

  const save = async (scope?: DeleteScope): Promise<void> => {
    if (!form || !canSave) return
    if (editing?.recurringEventId && !scope) return setAskScope(true)
    const mine = session.current
    setError('')
    setSaving(true)
    try {
      const f = { ...form, attendees: invitees }
      if (editing) await window.api.events.update(applyForm(editing, f, currentLocale()), scope)
      else await window.api.events.create(formToInput(f, currentLocale()))
      if (session.current === mine) close()
    } catch (e) {
      if (session.current === mine) {
        setError(errorText(e))
        setAskScope(false)
      }
    } finally {
      if (session.current === mine) setSaving(false)
    }
  }

  useEffect(() => {
    if (!opened) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault() // not the dialog's own cancel: that would close it behind React's back
        if (askScope) setAskScope(false)
        else close()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A modal dialog: Tab stays inside and the app behind is inert.
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  })

  if (!opened || !form) return null

  const set = (patch: Partial<EventForm>): void => setForm({ ...form, ...patch })
  const chooseAccount = (accountId: string): void =>
    set({ accountId, calendarId: soleId(writableCalendars(calendars, accountId)) })
  const commitDraft = (): void => {
    if (!pendingEmails.length) return
    set({ attendees: [...new Set([...form.attendees, ...pendingEmails])] })
    setDraft('')
  }
  const calendar = calendars.find((c) => c.accountId === form.accountId && c.id === form.calendarId)
  const cal = account?.color ?? 'var(--muted)'

  return (
    <dialog
      ref={dialog}
      className="mc-overlay"
      onCancel={(e) => e.preventDefault()}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <form
        className="mc-sheet editor"
        data-testid="editor"
        style={{ '--cal': cal } as React.CSSProperties}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="editor-head">
          <span className="editor-dot" />
          <input
            ref={titleRef}
            className="editor-title"
            placeholder={editing ? t('editor.title') : t('common.newEvent')}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>

        <div className="editor-grid">
          <label>{t('editor.account')}</label>
          {editing ? (
            <div className="editor-static" data-testid="editor-account">{account?.label ?? editing.accountId}</div>
          ) : (
            <Select
              data-testid="editor-account"
              aria-label={t('editor.account')}
              placeholder={t('editor.chooseAccount')}
              value={form.accountId}
              options={choices.map((a) => ({ value: a.id, label: a.label, hint: extraEmail(a.label, a.email), color: a.color }))}
              onChange={chooseAccount}
            />
          )}

          <label>{t('editor.calendar')}</label>
          {editing ? (
            <div className="editor-static" data-testid="editor-calendar">{calendar?.name ?? editing.calendarId}</div>
          ) : (
            <Select
              data-testid="editor-calendar"
              aria-label={t('editor.calendar')}
              placeholder={form.accountId ? t('editor.chooseCalendar') : t('editor.accountFirst')}
              disabled={!form.accountId}
              value={form.calendarId}
              options={accountCals.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
              onChange={(calendarId) => set({ calendarId })}
            />
          )}

          <label>{t('editor.allDay')}</label>
          <label className="editor-switch">
            <input
              type="checkbox"
              role="switch"
              className="mc-switch"
              aria-label={t('editor.allDay')}
              checked={form.allDay}
              onChange={(e) => setForm(setAllDay(form, e.target.checked))}
            />
          </label>

          <label>{t('editor.starts')}</label>
          <DateTimeField label={t('editor.starts')} value={form.start} dateOnly={form.allDay} onChange={(start) => setForm(moveStart(form, start))} />

          <label>{t('editor.ends')}</label>
          <DateTimeField label={t('editor.ends')} value={form.end} dateOnly={form.allDay} onChange={(end) => set({ end })} />

          <RepeatField
            value={form.repeat}
            start={form.start}
            status={form.repeatWas === undefined ? (repeatFailed ? 'error' : 'loading') : undefined}
            onChange={(repeat) => set({ repeat })}
          />

          <label>{t('editor.location')}</label>
          <input placeholder={t('editor.addLocation')} value={form.location} onChange={(e) => set({ location: e.target.value })} />

          <label>{t('editor.invitees')}</label>
          <div className="editor-chips">
            {form.attendees.map((m) => (
              <span key={m} className={isEmail(m) ? 'chip' : 'chip bad'}>
                {m}
                <button type="button" aria-label={t('editor.removeInvitee', { email: m })} onClick={() => set({ attendees: form.attendees.filter((x) => x !== m) })}>×</button>
              </span>
            ))}
            <input
              placeholder={form.attendees.length ? '' : t('editor.addPeople')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === ',') {
                  e.preventDefault()
                  commitDraft()
                } else if (e.key === 'Backspace' && !draft && form.attendees.length) {
                  set({ attendees: form.attendees.slice(0, -1) })
                }
              }}
            />
          </div>

          <label>{t('editor.notes')}</label>
          <textarea rows={3} placeholder={t('editor.addNotes')} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>

        <div className="editor-identity">
          {account ? (
            <>
              <div>{t('editor.createdIn')} <b>{account.label}</b>{extraEmail(account.label, account.email) && <> · {account.email}</>}</div>
              {invitees.length > 0 && <div className="editor-warn">{t('editor.invitesFrom')} <b>{account.email}</b></div>}
            </>
          ) : (
            <div>{t('editor.chooseWhich')}</div>
          )}
        </div>

        {error && <div className="editor-error" role="alert">{error}</div>}

        {askScope ? (
          <RecurringScope
            title={repeatChanged(form) ? t('scope.changeRule') : t('scope.save')}
            // The rule belongs to the series: no "this event only" for a rule change.
            scopes={repeatChanged(form) ? ['following', 'all'] : undefined}
            busy={saving}
            onPick={(scope) => void save(scope)}
            onCancel={() => setAskScope(false)}
          />
        ) : (
          <div className="mc-actions">
            <button type="button" className="mc-btn" onClick={close}>{t('common.cancel')}</button>
            <button type="submit" className="mc-btn primary" data-testid="editor-save" disabled={!canSave}>
              {saving ? t('editor.saving') : editing ? t('common.save') : t('editor.add')}
            </button>
          </div>
        )}
      </form>
    </dialog>
  )
}
