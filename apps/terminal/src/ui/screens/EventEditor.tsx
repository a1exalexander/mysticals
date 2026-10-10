/**
 * Event editor overlay (create when `event` is absent, edit otherwise). Form logic lives in core `logic/editor`.
 * Per-account isolation: no default account/calendar unless there is exactly one choice (`soleId`); editing never
 * changes an event's account or calendar.
 *
 * Keys (overlay owns all input): tab/shift-tab or ↓/↑ move between fields, typing edits text fields (←/→ move the
 * cursor, see `editLine`), ←/→ or space cycle pickers / toggle all-day, enter moves on (saves on the last field),
 * ctrl+s saves, esc cancels (after a changed form, a second esc confirms dropping the changes).
 * Saving a recurring event asks 1 this event / 2 this and following / 3 all events (esc back to the form);
 * a changed repeat rule offers only 2 and 3. Repeat: ←/→ cycles presets and "custom" (every / on days / stops fields).
 * Mouse: click a field to focus it (a focused picker / all-day again to cycle / toggle it); Save and Cancel buttons.
 * Fields that don't fit in `height` rows scroll with the focused one.
 */
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { format, isValid, parse } from 'date-fns'
import {
  applyForm, emptyForm, errorText, formFromEvent, formToInput, moveStart, repeatChanged, setAllDay, soleId, splitEmails,
  withLoadedRepeat, writableAccounts, writableCalendars, type EventForm
} from '@mysticals/core/logic/editor'
import {
  daysText, describe, endsText, everyText, parseDays, parseEnds, parseEvery, presetOf, presets, weekdayOf, withEnd, type PresetId
} from '@mysticals/core/logic/recurrence'
import type { CalEvent, DeleteScope, Recurrence } from '@mysticals/core/shared/types'
import { extraEmail } from '@mysticals/core/logic/details'
import { useApi, useDirectory } from '../hooks'
import { editLine, LineView, type Line } from '../lineEdit'
import { Button, Clickable, useKeys } from '../mouse'
import { useHeight, useScroll } from '../scroll'
import { C } from '../theme'

export interface EventEditorProps {
  event?: CalEvent
  initialStart?: Date
  onClose(): void
  /** Rows the overlay may take, border included. */
  height?: number
}

type TextField =
  | 'title' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | 'description' | 'attendees'
  | 'repeatEvery' | 'repeatDays' | 'repeatEnds'
type Field = TextField | 'account' | 'calendar' | 'allDay' | 'repeat'
type Texts = Record<TextField, string>

const LABELS: Record<Field, string> = {
  title: 'Title', account: 'Account', calendar: 'Calendar', allDay: 'All-day', startDate: 'Start date',
  startTime: 'Start time', endDate: 'End date', endTime: 'End time', location: 'Location', description: 'Notes',
  attendees: 'Invitees', repeat: 'Repeat', repeatEvery: 'Every', repeatDays: 'On days', repeatEnds: 'Stops'
}
const SCOPE_KEYS: Record<string, DeleteScope> = { '1': 'one', '2': 'following', '3': 'all' }
const HINTS: Partial<Record<Field, string>> = {
  startDate: 'YYYY-MM-DD', startTime: 'HH:mm', endDate: 'YYYY-MM-DD', endTime: 'HH:mm',
  attendees: 'a@x.com, b@y.com', title: 'New Event', repeatEvery: '2 weeks', repeatDays: 'mo th',
  repeatEnds: 'never · 2026-12-31 · 10 times'
}
const PICKERS = new Set<Field>(['account', 'calendar', 'allDay', 'repeat'])

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

const repeatTexts = (r: Recurrence | null, start: string): Pick<Texts, 'repeatEvery' | 'repeatDays' | 'repeatEnds'> => ({
  repeatEvery: r ? everyText(r) : '',
  repeatDays: daysText(r?.byDay?.length ? r.byDay : [weekdayOf(start)]),
  repeatEnds: r ? endsText(r) : 'never'
})

const textsFrom = (f: EventForm): Texts => ({
  title: f.title, location: f.location, description: f.description, attendees: f.attendees.join(', '), ...timeTexts(f),
  ...repeatTexts(f.repeat, f.start)
})

interface State {
  form: EventForm
  texts: Texts
  focus: number
  /** Cursor in the focused text field. */
  at: number
  /** "custom" picked for the repeat rule (also shown for a rule no preset matches). */
  custom: boolean
}

const isCustom = (s: Pick<State, 'form' | 'custom'>): boolean =>
  !!s.form.repeat && !s.form.repeat.rule && (s.custom || presetOf(s.form.repeat, s.form.start) === 'custom')

const fieldsFor = (s: Pick<State, 'form' | 'custom'>, editing: boolean): Field[] => {
  const { form } = s
  const custom = isCustom(s)
  return [
    'title',
    ...(editing ? [] : (['account', 'calendar'] as const)),
    'allDay',
    'startDate',
    ...(form.allDay ? [] : (['startTime'] as const)),
    'endDate',
    ...(form.allDay ? [] : (['endTime'] as const)),
    'repeat',
    ...(custom ? (['repeatEvery'] as const) : []),
    ...(custom && form.repeat?.freq === 'weekly' ? (['repeatDays'] as const) : []),
    ...(form.repeat && !form.repeat.rule ? (['repeatEnds'] as const) : []),
    'location',
    'description',
    'attendees'
  ]
}

/** The form's rule with the repeat text fields applied. Throws a user-facing Error. */
function readRepeat(s: State): Recurrence | null {
  const r = s.form.repeat
  if (!r || r.rule) return r
  const { until: _u, count: _c, ...base } = r
  const rule: Recurrence = isCustom(s) ? { ...parseEvery(s.texts.repeatEvery) } : base
  if (isCustom(s) && rule.freq === 'weekly') rule.byDay = parseDays(s.texts.repeatDays)
  return { ...rule, ...parseEnds(s.texts.repeatEnds) }
}

export function EventEditor({ event, initialStart, onClose, height = Infinity }: EventEditorProps) {
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
  // Which part of a recurring series the save is for, asked on save.
  // 'rule': the repeat rule changed, which only "this and following" / "all events" can do.
  const [askScope, setAskScopeState] = useState<false | 'any' | 'rule'>(false)
  const asking = useRef<false | 'any' | 'rule'>(false)
  const setAskScope = (on: false | 'any' | 'rule'): void => {
    asking.current = on
    setAskScopeState(on)
  }
  // esc on a changed form asks first; `pristine` is the form as opened (and as loaded, for a series' rule).
  const pristine = useRef('')
  const snap = (s: State): string => JSON.stringify([s.form, s.texts])
  const [discard, setDiscardState] = useState(false)
  const discarding = useRef(false)
  const setDiscard = (on: boolean): void => {
    discarding.current = on
    setDiscardState(on)
  }
  const cancel = (): void => {
    if (discarding.current || !latest.current || snap(latest.current) === pristine.current) return onClose()
    setDiscard(true)
  }
  const [repeatFailed, setRepeatFailed] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  useEffect(() => {
    if (latest.current || !loaded) return
    // emptyForm rounds `now` up to the next hour, so the new event lands on the navigated day.
    const form = event ? formFromEvent(event) : emptyForm(accounts, calendars, {}, initialStart)
    const texts = textsFrom(form)
    latest.current = { form, texts, focus: 0, at: [...texts.title].length, custom: false }
    pristine.current = snap(latest.current)
    setState(latest.current)
    // A series' rule isn't cached: read it; until then the rule can't be changed.
    if (event?.recurringEventId) {
      api.events.recurrence(event).then(
        (rule) => {
          if (!alive.current || !latest.current) return
          const f = withLoadedRepeat(latest.current.form, rule)
          const clean = snap(latest.current) === pristine.current
          update({ form: f, texts: { ...latest.current.texts, ...repeatTexts(rule, f.start) } })
          if (clean) pristine.current = snap(latest.current)
        },
        () => alive.current && setRepeatFailed(true)
      )
    }
  }, [loaded])

  const choices = writableAccounts(accounts, calendars)

  const save = async (scope?: DeleteScope): Promise<void> => {
    if (!latest.current || busy.current) return
    const { form, texts } = latest.current
    let repeat: Recurrence | null
    try {
      repeat = readRepeat(latest.current)
    } catch (e) {
      return setError(errorText(e))
    }
    setError('')
    const start = toLocal(texts.startDate, form.allDay ? form.start.slice(11) : texts.startTime)
    const end = toLocal(texts.endDate, form.allDay ? form.end.slice(11) : texts.endTime)
    if (!start) return setError(`Invalid start (use YYYY-MM-DD${form.allDay ? '' : ' and HH:mm'})`)
    if (!end) return setError(`Invalid end (use YYYY-MM-DD${form.allDay ? '' : ' and HH:mm'})`)
    const f: EventForm = {
      ...form,
      title: texts.title, location: texts.location, description: texts.description,
      attendees: splitEmails(texts.attendees), start, end, repeat
    }
    let request: Promise<unknown>
    try {
      // Both throw a user-facing Error on invalid input, before any request is sent.
      const edited = event && applyForm(event, f)
      if (edited && event.recurringEventId && !scope) return setAskScope(repeatChanged(f) ? 'rule' : 'any')
      request = edited ? api.events.update(edited, scope) : api.events.create(formToInput(f))
    } catch (e) {
      return setError(errorText(e))
    }
    setAskScope(false)
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

  const pick = (st: State, field: Field, dir: 1 | -1): void => {
    const { form, texts } = st
    if (field === 'account') {
      const accountId = cycle(choices, form.accountId, dir)
      update({ form: { ...form, accountId, calendarId: soleId(writableCalendars(calendars, accountId)) } })
    } else if (field === 'calendar') {
      update({ form: { ...form, calendarId: cycle(writableCalendars(calendars, form.accountId), form.calendarId, dir) } })
    } else if (field === 'allDay') {
      const f = setAllDay(form, !form.allDay)
      update({ form: f, texts: { ...texts, ...timeTexts(f) } })
    } else if (field === 'repeat') {
      if (form.repeatWas === undefined) return // the series' rule is still loading
      const ids: PresetId[] = [...presets(form.start).map((p) => p.id), 'custom']
      const at = ids.indexOf(isCustom(st) ? 'custom' : presetOf(form.repeat, form.start))
      const next = ids[(at + dir + ids.length) % ids.length]
      // Keep what was typed into the rule's fields (its end, the custom parts) where it still applies.
      let prev = form.repeat
      try {
        prev = readRepeat(st)
      } catch {
        // half-typed: fall back to the last valid rule
      }
      const preset = presets(form.start).find((p) => p.id === next)?.recurrence
      const repeat = next === 'custom' ? (prev && !prev.rule ? prev : withEnd({ freq: 'weekly' }, prev)) : preset ? withEnd(preset, prev) : null
      update({ form: { ...form, repeat }, custom: next === 'custom', texts: { ...texts, ...repeatTexts(repeat, form.start) } })
    }
  }

  const edit = ({ form, texts }: State, field: TextField, { value, at }: Line): void => {
    const next = { ...texts, [field]: value }
    if (field === 'startDate' || field === 'startTime') {
      // Keep the duration: once the start parses, the end follows it (core moveStart).
      // All-day keeps the hidden time part so toggling back restores it.
      const start = toLocal(next.startDate, form.allDay ? form.start.slice(11) : next.startTime)
      if (start) {
        const f = moveStart(form, start)
        return update({ form: f, at, texts: { ...next, endDate: f.end.slice(0, 10), endTime: f.end.slice(11) } })
      }
    } else if (field === 'endDate' || field === 'endTime') {
      const end = toLocal(next.endDate, form.allDay ? form.end.slice(11) : next.endTime)
      if (end) return update({ form: { ...form, end }, at, texts: next })
    }
    update({ texts: next, at })
  }

  /** Focuses field `i`, with the cursor at the end of its text. */
  const focusOn = (s: State, i: number): void => {
    const f = fieldsFor(s, !!event)[i]
    update({ focus: i, at: f && !PICKERS.has(f) ? [...s.texts[f as TextField]].length : 0 })
  }

  const clickField = (f: Field): void => {
    const s = latest.current
    if (!s || busy.current) return
    const i = fieldsFor(s, !!event).indexOf(f)
    if (i < 0) return // fixed rows (account/calendar while editing)
    if (i === s.focus && PICKERS.has(f)) return pick(s, f, 1)
    focusOn(s, i)
  }

  useKeys((input, key) => {
    if (key.escape && asking.current && !busy.current) return setAskScope(false)
    if (key.escape) return busy.current ? onClose() : cancel()
    if (discarding.current) return setDiscard(false) // any other key keeps editing
    const s = latest.current
    if (!s || busy.current) return
    if (asking.current) {
      if (!Object.hasOwn(SCOPE_KEYS, input) || (asking.current === 'rule' && SCOPE_KEYS[input] === 'one')) return
      return void save(SCOPE_KEYS[input])
    }
    if (key.ctrl && input === 's') return void save()
    const fields = fieldsFor(s, !!event)
    const i = Math.min(s.focus, fields.length - 1)
    const field = fields[i]
    const move = (dir: 1 | -1): void => focusOn(s, (i + dir + fields.length) % fields.length)
    if (key.tab) return move(key.shift ? -1 : 1)
    if (key.downArrow) return move(1)
    if (key.upArrow) return move(-1)
    if (key.return) return i === fields.length - 1 ? void save() : move(1)
    if (PICKERS.has(field)) {
      if (key.leftArrow) pick(s, field, -1)
      else if (key.rightArrow || input === ' ') pick(s, field, 1)
      return
    }
    const text = field as TextField
    const line = editLine({ value: s.texts[text], at: s.at }, input, key)
    if (line) edit(s, text, line)
  })

  const fields = state ? fieldsFor(state, !!event) : []
  const current = fields[Math.min(state?.focus ?? 0, fields.length - 1)]
  // Edit mode shows account/calendar as fixed rows that can't take focus.
  const rows: Field[] = event ? ['title', 'account', 'calendar', ...fields.slice(1)] : fields
  const [foot, footHeight] = useHeight()
  const fit = Math.max(height - 4 - footHeight, 1) // border, heading, the gap above the footer
  const at = Math.max(rows.indexOf(current), 0)
  const [top] = useScroll(at, at, fit, rows.length)

  if (!state) return <Text color={C.muted}>Loading…</Text>
  const { form, texts } = state

  const account = accounts.find((a) => a.id === form.accountId)
  const calendar = calendars.find((c) => c.accountId === form.accountId && c.id === form.calendarId)

  const value = (f: Field): { text: string; dim?: boolean } => {
    switch (f) {
      case 'account': {
        const name = account && [account.label, extraEmail(account.label, account.email)].filter(Boolean).join(' · ')
        if (event) return { text: name || form.accountId }
        return name ? { text: name } : { text: '‹ choose account ›', dim: true }
      }
      case 'calendar':
        if (event) return { text: calendar?.name ?? form.calendarId }
        if (!form.accountId) return { text: 'choose an account first', dim: true }
        return calendar ? { text: calendar.name } : { text: '‹ choose calendar ›', dim: true }
      case 'allDay':
        return { text: form.allDay ? '[x]' : '[ ]' }
      case 'repeat':
        if (form.repeatWas === undefined) return { text: repeatFailed ? 'couldn’t load; stays as it is' : 'loading…', dim: true }
        if (form.repeat?.rule) return { text: describe(form.repeat, form.start) }
        if (isCustom(state)) return { text: 'Custom' }
        return { text: presets(form.start).find((p) => p.id === presetOf(form.repeat, form.start))!.label }
      default:
        return texts[f] ? { text: texts[f] } : { text: HINTS[f] ?? '', dim: true }
    }
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.muted} paddingX={1}>
      <Text bold>
        {event ? 'Edit event' : 'New event'}
        {rows.length > fit && <Text color={C.muted} bold={false}>  ↑↓ more fields</Text>}
      </Text>
      {rows.slice(top, top + fit).map((f) => {
        const on = f === current
        const v = value(f)
        const picker = (!event && (f === 'account' || f === 'calendar')) || f === 'repeat'
        return (
          <Clickable key={f} height={1} onClick={() => clickField(f)}>
            <Box flexShrink={0}>
              <Text color={on ? C.cyan : undefined}>{on ? '› ' : '  '}{LABELS[f].padEnd(11)}</Text>
            </Box>
            {on && !PICKERS.has(f) ? (
              texts[f as TextField] ? (
                <LineView value={texts[f as TextField]} at={state.at} />
              ) : (
                <Text wrap="truncate-end">
                  <Text inverse> </Text>
                  <Text color={C.muted}>{HINTS[f] ?? ''}</Text>
                </Text>
              )
            ) : (
              <Text wrap="truncate-end" color={v.dim ? C.muted : undefined} inverse={on && !v.dim && !picker}>
                {v.text}
              </Text>
            )}
            {on && picker && (
              <Box flexShrink={0}>
                <Text color={C.muted}>  ←/→ or click</Text>
              </Box>
            )}
          </Clickable>
        )
      })}
      <Box ref={foot} flexDirection="column" flexShrink={0} marginTop={1}>
        {error && <Text color={C.red}>{error}</Text>}
        {saving ? (
          <Text color={C.yellow}>Saving…</Text>
        ) : discard ? (
          <Box flexWrap="wrap">
            <Text color={C.yellow}>Discard your changes? </Text>
            <Button k="esc" label="discard" color={C.red} onPress={onClose} />
            <Button k="enter" label="keep editing" onPress={() => setDiscard(false)} />
          </Box>
        ) : askScope ? (
          <Box flexWrap="wrap">
            <Text color={C.yellow}>{askScope === 'rule' ? 'Change the repeat rule for: ' : 'Save recurring event: '}</Text>
            {askScope !== 'rule' && <Button k="1" label="this event" color={C.green} onPress={() => void save('one')} />}
            <Button k="2" label="this and following" color={C.green} onPress={() => void save('following')} />
            <Button k="3" label="all events" color={C.green} onPress={() => void save('all')} />
            <Button k="esc" label="back" onPress={() => setAskScope(false)} />
          </Box>
        ) : (
          <Box flexWrap="wrap">
            <Box marginRight={2}>
              <Text color={C.muted}>tab/↑↓ field · ←/→ cursor or pick</Text>
            </Box>
            <Button k="ctrl+s" label="save" color={C.green} onPress={() => void save()} />
            <Button k="esc" label="cancel" onPress={cancel} />
          </Box>
        )}
      </Box>
    </Box>
  )
}
