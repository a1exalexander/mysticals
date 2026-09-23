import { useEffect, useRef, useState } from 'react'
import type { CalEvent } from '@shared/types'
import { bus, type BusEvents } from '../bus'
import { useDirectory } from './ui/useDirectory'
import { DateTimeField } from './ui/DateTimeField'
import {
  applyForm, emptyForm, setAllDay, errorText, formFromEvent, formToInput, isEmail, moveStart, soleId, splitEmails,
  writableAccounts, writableCalendars, type EventForm
} from './EventEditor.logic'
import './ui/ui.css'
import './EventEditor.css'

type Opened = { mode: 'create'; prefill: BusEvents['event:create'] } | { mode: 'edit'; event: CalEvent }

// Create/edit sheet. Account + calendar are an explicit choice; editing never moves an event between accounts.
export function EventEditorHost(): React.JSX.Element | null {
  const { accounts, calendars, loaded } = useDirectory()
  const [opened, setOpened] = useState<Opened | null>(null)
  const [form, setForm] = useState<EventForm | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const session = useRef(0) // bumps on every open/close so a late save can't touch a newer editor

  useEffect(() => {
    const open = (o: Opened): void => {
      session.current++
      setSaving(false)
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

  const save = async (): Promise<void> => {
    if (!form || !canSave) return
    const mine = session.current
    setError('')
    setSaving(true)
    try {
      const f = { ...form, attendees: invitees }
      if (editing) await window.api.events.update(applyForm(editing, f))
      else await window.api.events.create(formToInput(f))
      if (session.current === mine) close()
    } catch (e) {
      if (session.current === mine) setError(errorText(e))
    } finally {
      if (session.current === mine) setSaving(false)
    }
  }

  useEffect(() => {
    if (!opened) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
  const accent = account?.color ?? 'var(--muted)'

  return (
    <div className="mc-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="mc-sheet editor"
        data-testid="editor"
        style={{ '--accent': accent } as React.CSSProperties}
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
            placeholder={editing ? 'Title' : 'New Event'}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>

        <div className="editor-grid">
          <label>Account</label>
          {editing ? (
            <div className="editor-static" data-testid="editor-account">{account?.label ?? editing.accountId}</div>
          ) : (
            <select data-testid="editor-account" value={form.accountId} onChange={(e) => chooseAccount(e.target.value)}>
              {!form.accountId && <option value="" disabled>Choose account…</option>}
              {choices.map((a) => (
                <option key={a.id} value={a.id}>{a.label} · {a.email}</option>
              ))}
            </select>
          )}

          <label>Calendar</label>
          {editing ? (
            <div className="editor-static" data-testid="editor-calendar">{calendar?.name ?? editing.calendarId}</div>
          ) : (
            <select
              data-testid="editor-calendar"
              value={form.calendarId}
              disabled={!form.accountId}
              onChange={(e) => set({ calendarId: e.target.value })}
            >
              <option value="" disabled>{form.accountId ? 'Choose calendar…' : 'Choose an account first'}</option>
              {accountCals.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          <label>All-day</label>
          <label className="editor-switch">
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm(setAllDay(form, e.target.checked))} />
          </label>

          <label>Starts</label>
          <DateTimeField label="Starts" value={form.start} dateOnly={form.allDay} onChange={(start) => setForm(moveStart(form, start))} />

          <label>Ends</label>
          <DateTimeField label="Ends" value={form.end} dateOnly={form.allDay} onChange={(end) => set({ end })} />

          <label>Location</label>
          <input placeholder="Add location" value={form.location} onChange={(e) => set({ location: e.target.value })} />

          <label>Invitees</label>
          <div className="editor-chips">
            {form.attendees.map((m) => (
              <span key={m} className={isEmail(m) ? 'chip' : 'chip bad'}>
                {m}
                <button type="button" aria-label={`Remove ${m}`} onClick={() => set({ attendees: form.attendees.filter((x) => x !== m) })}>×</button>
              </span>
            ))}
            <input
              placeholder={form.attendees.length ? '' : 'Add people (optional)'}
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

          <label>Notes</label>
          <textarea rows={3} placeholder="Add notes" value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>

        <div className="editor-identity">
          {account ? (
            <>
              <div>Created in <b>{account.label}</b> · {account.email}</div>
              {invitees.length > 0 && <div className="editor-warn">Invitations will be sent from <b>{account.email}</b></div>}
            </>
          ) : (
            <div>Choose which account this event belongs to.</div>
          )}
        </div>

        {error && <div className="editor-error" role="alert">{error}</div>}

        <div className="mc-actions">
          <button type="button" className="mc-btn" onClick={close}>Cancel</button>
          <button type="submit" className="mc-btn primary" data-testid="editor-save" disabled={!canSave}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add Event'}
          </button>
        </div>
      </form>
    </div>
  )
}
