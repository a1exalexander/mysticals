/**
 * Event editor overlay (create when `event` is absent, edit otherwise). Form logic lives in core `logic/editor`.
 * Per-account isolation: no default account/calendar unless there is exactly one choice (`soleId`); editing never
 * changes an event's account or calendar.
 *
 * Keys (overlay owns all input): tab/shift-tab or ↓/↑ move between fields, typing edits text fields, ←/→ or space
 * cycle pickers / toggle all-day, enter moves on (saves on the last field), ctrl+s saves, esc cancels.
 * Mouse: click a field to focus it (a focused picker / all-day again to cycle / toggle it); Save and Cancel buttons.
 */
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { format, isValid, parse } from 'date-fns'
import {
  applyForm, emptyForm, errorText, formFromEvent, formToInput, moveStart, setAllDay, soleId, splitEmails,
  writableAccounts, writableCalendars, type EventForm
} from '@multicals/core/logic/editor'
import type { CalEvent } from '@multicals/core/shared/types'
import { useApi, useDirectory } from '../hooks'
import { Button, Clickable, useKeys } from '../mouse'
import { C } from '../theme'

export interface EventEditorProps {
  event?: CalEvent
  initialStart?: Date
  onClose(): void
}

type TextField = 'title' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | 'description' | 'attendees'
type Field = TextField | 'account' | 'calendar' | 'allDay'
type Texts = Record<TextField, string>

const LABELS: Record<Field, string> = {
  title: 'Title', account: 'Account', calendar: 'Calendar', allDay: 'All-day', startDate: 'Start date',
  startTime: 'Start time', endDate: 'End date', endTime: 'End time', location: 'Location', description: 'Notes',
  attendees: 'Invitees'
}
const HINTS: Partial<Record<Field, string>> = {
  startDate: 'YYYY-MM-DD', startTime: 'HH:mm', endDate: 'YYYY-MM-DD', endTime: 'HH:mm',
  attendees: 'a@x.com, b@y.com', title: 'New Event'
}

/** Strictly parses 'YYYY-MM-DD' + 'HH:mm' into the form's local 'YYYY-MM-DDTHH:mm', or undefined. */
function toLocal(date: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return
  const d = parse(`${date}T${time}`, "yyyy-MM-dd'T'HH:mm", new Date())
  // Round-trip rejects rollovers like 2026-02-31 or 25:00.
  return isValid(d) && format(d, "yyyy-MM-dd'T'HH:mm") === `${date}T${time}` ? `${date}T${time}` : undefined
}

const timeTexts = (f: EventForm): Pick<Texts, 'startDate' | 'startTime' | 'endDate' | 'endTime'> => ({
  startDate: f.start.slice(0, 10), startTime: f.start.slice(11), endDate: f.end.slice(0, 10), endTime: f.end.slice(11)
})

const textsFrom = (f: EventForm): Texts => ({
  title: f.title, location: f.location, description: f.description, attendees: f.attendees.join(', '), ...timeTexts(f)
})

interface State {
  form: EventForm
  texts: Texts
  focus: number
}

const fieldsFor = (form: EventForm, editing: boolean): Field[] => [
  'title',
  ...(editing ? [] : (['account', 'calendar'] as const)),
  'allDay',
  'startDate',
  ...(form.allDay ? [] : (['startTime'] as const)),
  'endDate',
  ...(form.allDay ? [] : (['endTime'] as const)),
  'location',
  'description',
  'attendees'
]

export function EventEditor({ event, initialStart, onClose }: EventEditorProps) {
  const api = useApi()
  const { accounts, calendars, loaded } = useDirectory()
  const [state, setState] = useState<State>()
  // Keys can arrive faster than renders (paste, key repeat), so handlers read and write the latest state via a ref.
  const latest = useRef<State | undefined>(undefined)
  const update = (patch: Partial<State>): void => {
    if (!latest.current) return
    latest.current = { ...latest.current, ...patch }
    setState(latest.current)
  }
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  useEffect(() => {
    if (latest.current || !loaded) return
    // emptyForm rounds `now` up to the next hour, so the new event lands on the navigated day.
    const form = event ? formFromEvent(event) : emptyForm(accounts, calendars, {}, initialStart)
    latest.current = { form, texts: textsFrom(form), focus: 0 }
    setState(latest.current)
  }, [loaded])

  const choices = writableAccounts(accounts, calendars)

  const save = async (): Promise<void> => {
    if (!latest.current || busy.current) return
    const { form, texts } = latest.current
    setError('')
    const start = toLocal(texts.startDate, form.allDay ? form.start.slice(11) : texts.startTime)
    const end = toLocal(texts.endDate, form.allDay ? form.end.slice(11) : texts.endTime)
    if (!start) return setError(`Invalid start (use YYYY-MM-DD${form.allDay ? '' : ' and HH:mm'})`)
    if (!end) return setError(`Invalid end (use YYYY-MM-DD${form.allDay ? '' : ' and HH:mm'})`)
    const f: EventForm = {
      ...form,
      title: texts.title, location: texts.location, description: texts.description,
      attendees: splitEmails(texts.attendees), start, end
    }
    let request: Promise<unknown>
    try {
      // Both throw a user-facing Error on invalid input, before any request is sent.
      request = event ? api.events.update(applyForm(event, f)) : api.events.create(formToInput(f))
    } catch (e) {
      return setError(errorText(e))
    }
    busy.current = true
    setSaving(true)
    try {
      await request
      if (alive.current) onClose()
    } catch (e) {
      busy.current = false
      if (alive.current) {
        setError(errorText(e))
        setSaving(false)
      }
    }
  }

  const cycle = <T extends { id: string }>(items: T[], id: string, dir: 1 | -1): string => {
    if (!items.length) return ''
    const i = items.findIndex((x) => x.id === id)
    return items[i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length].id
  }

  const pick = ({ form, texts }: State, field: Field, dir: 1 | -1): void => {
    if (field === 'account') {
      const accountId = cycle(choices, form.accountId, dir)
      update({ form: { ...form, accountId, calendarId: soleId(writableCalendars(calendars, accountId)) } })
    } else if (field === 'calendar') {
      update({ form: { ...form, calendarId: cycle(writableCalendars(calendars, form.accountId), form.calendarId, dir) } })
    } else if (field === 'allDay') {
      const f = setAllDay(form, !form.allDay)
      update({ form: f, texts: { ...texts, ...timeTexts(f) } })
    }
  }

  const edit = ({ form, texts }: State, field: TextField, value: string): void => {
    const next = { ...texts, [field]: value }
    if (field === 'startDate' || field === 'startTime') {
      // Keep the duration: once the start parses, the end follows it (core moveStart).
      // All-day keeps the hidden time part so toggling back restores it.
      const start = toLocal(next.startDate, form.allDay ? form.start.slice(11) : next.startTime)
      if (start) {
        const f = moveStart(form, start)
        return update({ form: f, texts: { ...next, endDate: f.end.slice(0, 10), endTime: f.end.slice(11) } })
      }
    } else if (field === 'endDate' || field === 'endTime') {
      const end = toLocal(next.endDate, form.allDay ? form.end.slice(11) : next.endTime)
      if (end) return update({ form: { ...form, end }, texts: next })
    }
    update({ texts: next })
  }

  const clickField = (f: Field): void => {
    const s = latest.current
    if (!s || busy.current) return
    const i = fieldsFor(s.form, !!event).indexOf(f)
    if (i < 0) return // fixed rows (account/calendar while editing)
    if (i === s.focus && (f === 'account' || f === 'calendar' || f === 'allDay')) return pick(s, f, 1)
    update({ focus: i })
  }

  useKeys((input, key) => {
    if (key.escape) return onClose()
    const s = latest.current
    if (!s || busy.current) return
    if (key.ctrl && input === 's') return void save()
    const fields = fieldsFor(s.form, !!event)
    const i = Math.min(s.focus, fields.length - 1)
    const field = fields[i]
    const move = (dir: 1 | -1): void => update({ focus: (i + dir + fields.length) % fields.length })
    if (key.tab) return move(key.shift ? -1 : 1)
    if (key.downArrow) return move(1)
    if (key.upArrow) return move(-1)
    if (key.return) return i === fields.length - 1 ? void save() : move(1)
    if (field === 'account' || field === 'calendar' || field === 'allDay') {
      if (key.leftArrow) pick(s, field, -1)
      else if (key.rightArrow || input === ' ') pick(s, field, 1)
      return
    }
    if (key.backspace || key.delete) return edit(s, field, s.texts[field].slice(0, -1))
    if (key.ctrl || key.meta || !input) return
    // ponytail: append-only single-line editing (no cursor movement); a real cursor if users ask for it.
    const printable = input.replace(/[\u0000-\u001f\u007f]/g, '')
    if (printable) edit(s, field, s.texts[field] + printable)
  })

  if (!state) return <Text color={C.muted}>Loading…</Text>
  const { form, texts } = state
  const fields = fieldsFor(form, !!event)
  const current = fields[Math.min(state.focus, fields.length - 1)]


  const account = accounts.find((a) => a.id === form.accountId)
  const calendar = calendars.find((c) => c.accountId === form.accountId && c.id === form.calendarId)

  const value = (f: Field): { text: string; dim?: boolean } => {
    switch (f) {
      case 'account':
        if (event) return { text: account ? `${account.label} · ${account.email}` : form.accountId }
        return account ? { text: `${account.label} · ${account.email}` } : { text: '‹ choose account ›', dim: true }
      case 'calendar':
        if (event) return { text: calendar?.name ?? form.calendarId }
        if (!form.accountId) return { text: 'choose an account first', dim: true }
        return calendar ? { text: calendar.name } : { text: '‹ choose calendar ›', dim: true }
      case 'allDay':
        return { text: form.allDay ? '[x]' : '[ ]' }
      default:
        return texts[f] ? { text: texts[f] } : { text: HINTS[f] ?? '', dim: true }
    }
  }

  // Edit mode shows account/calendar as fixed rows that can't take focus.
  const rows: Field[] = event ? ['title', 'account', 'calendar', ...fields.slice(1)] : fields

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={1}>
      <Text bold>{event ? 'Edit event' : 'New event'}</Text>
      {rows.map((f) => {
        const on = f === current
        const v = value(f)
        const picker = !event && (f === 'account' || f === 'calendar')
        return (
          <Clickable key={f} onClick={() => clickField(f)}>
            <Text color={on ? C.cyan : undefined}>{on ? '› ' : '  '}{LABELS[f].padEnd(11)}</Text>
            <Text color={v.dim ? C.muted : undefined} inverse={on && !v.dim && !picker}>
              {v.text}
            </Text>
            {on && picker && <Text color={C.muted}>  ←/→ or click</Text>}
          </Clickable>
        )
      })}
      <Box marginTop={1}>
        <Text color={C.muted}>
          {account ? `Organizer: ${account.email}` : 'Choose which account this event belongs to.'}
        </Text>
      </Box>
      {error && <Text color={C.red}>{error}</Text>}
      {saving ? (
        <Text color={C.yellow}>Saving…</Text>
      ) : (
        <Box flexWrap="wrap">
          <Box marginRight={2}>
            <Text color={C.muted}>tab/↑↓ move · ←/→/space pick</Text>
          </Box>
          <Button k="ctrl+s" label="save" color={C.green} onPress={() => void save()} />
          <Button k="esc" label="cancel" onPress={onClose} />
        </Box>
      )}
    </Box>
  )
}
