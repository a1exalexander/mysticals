import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CalEvent, DeleteScope, PartStat } from '@shared/types'
import { bus, type BusEvents } from '../bus'
import { bulkTargets, isPick, selection } from '../selection'
import { useDirectory } from './ui/useDirectory'
import { onLaterScroll } from './ui/usePopover'
import { EventColors } from './EventColors'
import { eventColorOf } from '@mysticals/core/logic/colors'
import { canEdit, formatWhen } from '@mysticals/core/logic/details'
import { copyInput, type PasteSlot } from '@mysticals/core/logic/copy'
import { eventKey } from '@mysticals/core/logic/layout'
import type { Key } from '@mysticals/core/i18n'
import { currentLocale, errorText, t, useLocale } from '../i18n'
import { hour12 } from '../clock'
import './EventMenu.css'

type Opened = ({ kind: 'event' } & BusEvents['menu:event']) | ({ kind: 'slot' } & BusEvents['menu:slot'])

/** The event "Copy" put aside for "Paste" on a free time or day; app-wide, lives while the app runs. */
let copied: CalEvent | null = null

/** An event's title, or "Untitled" for one without. */
export const name = (e: CalEvent): string => e.title || t('common.untitled')

/** The own reply to an invite. */
export type Reply = Exclude<PartStat, 'needsAction'>

/**
 * Spread onto an event pill: right-click opens its menu (instead of the window's native one), for the whole selection
 * when the pill is in it; ⌘-click (Ctrl-click off macOS) picks it instead of opening it, a plain click drops the
 * selection. Marks the pill picked (`data-selected`) and busy while an action on it runs (`aria-busy`, a spinner): the
 * view re-renders on those through `useMarks`.
 */
export function eventMenu(
  event: CalEvent
): Pick<React.HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onClickCapture' | 'aria-busy'> & { 'data-event-key': string; 'data-selected'?: boolean } {
  return {
    'data-event-key': eventKey(event),
    'data-selected': selection.has(event) || undefined,
    'aria-busy': selection.isBusy(event) || undefined,
    onClickCapture: (e) => {
      if (!isPick(e)) return selection.clear()
      e.preventDefault()
      e.stopPropagation()
      selection.toggle(event)
    },
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!selection.has(event)) selection.clear()
      bus.emit('menu:event', { event, x: e.clientX, y: e.clientY })
    }
  }
}

/**
 * Spread onto an event pill in the grids: a keyboard control named by its title and time. Enter/Space open it (its
 * click), the menu key or Shift+F10 its menu, ↑/↓ step to the earlier/later event of the same day, ←/→ (h/l) to the
 * previous/next day with events. Only the `tabbable` pill of a day is a Tab stop. Keys handled here never reach the
 * window shortcuts, so ←/→ move focus instead of the period.
 */
export function eventButton(
  event: CalEvent,
  tabbable: boolean
): Pick<React.HTMLAttributes<HTMLElement>, 'role' | 'tabIndex' | 'aria-label' | 'onKeyDown'> {
  return {
    role: 'button',
    tabIndex: tabbable ? 0 : -1,
    'aria-label': `${name(event)}, ${formatWhen(event, currentLocale(), hour12())}`,
    onKeyDown: (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.currentTarget
      const k = e.key
      if (k === 'Enter' || k === ' ') el.click()
      else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
        const r = el.getBoundingClientRect()
        bus.emit('menu:event', { event, x: r.left, y: r.top })
      } else if (k === 'ArrowDown' || k === 'ArrowUp') {
        const day = [...(el.parentElement?.querySelectorAll<HTMLElement>(':scope > [role=button]') ?? [])].sort((a, b) => a.offsetTop - b.offsetTop)
        day[day.indexOf(el) + (k === 'ArrowDown' ? 1 : -1)]?.focus()
      } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'h' || k === 'l') {
        // The day containers (columns, all-day or month cells) are siblings; each has at most one Tab stop.
        const stops = [...(el.parentElement?.parentElement?.querySelectorAll<HTMLElement>(':scope > * > [role=button][tabindex="0"]') ?? [])]
        const i = stops.findIndex((s) => s.parentElement === el.parentElement)
        stops[i + (k === 'ArrowLeft' || k === 'h' ? -1 : 1)]?.focus()
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
  }
}

/** Right-click on a free time or day: paste a copied event there, or start a new one. */
export function slotMenu(at: (e: React.MouseEvent<HTMLElement>) => { slot: PasteSlot; end: string }): Pick<React.HTMLAttributes<HTMLElement>, 'onContextMenu'> {
  return {
    onContextMenu: (e) => {
      e.preventDefault()
      bus.emit('menu:slot', { ...at(e), x: e.clientX, y: e.clientY })
    }
  }
}

/** Creates `e`'s copy; the toast's Undo deletes it again. */
function createCopy(e: CalEvent, at: PasteSlot | undefined, done: 'toast.duplicated' | 'toast.pasted'): void {
  window.api.events.create(copyInput(e, at)).then(
    (made) =>
      bus.emit('toast', {
        text: t(done, { title: name(e) }),
        action: {
          label: t('common.undo'),
          run: () =>
            void window.api.events.delete(made, 'one').catch((err) =>
              bus.emit('toast', { text: t('toast.deleteFailed', { title: name(made), error: errorText(err) }), error: true })
            )
        }
      }),
    (err) => bus.emit('toast', { text: t('toast.createFailed', { title: name(e), error: errorText(err) }), error: true })
  )
}

/**
 * Deletes an event, the same from the menu and the details popover: a recurring event first asks which part
 * of the series goes; a single one goes at once. Undo brings a single one back.
 */
export function deleteEvent(e: CalEvent): void {
  const run = (scope: DeleteScope): void =>
    void selection.track(e, window.api.events.delete(e, scope)).then(
      () =>
        bus.emit('toast', {
          text: t(scope === 'all' ? 'toast.deletedAll' : scope === 'following' ? 'toast.deletedFollowing' : 'toast.deleted', { title: name(e) }),
          // A deleted occurrence of a series can't be put back into it: only a single event is recreated.
          action: e.recurringEventId
            ? undefined
            : {
                label: t('common.undo'),
                run: () =>
                  void window.api.events.create(copyInput(e, undefined, { guests: true })).catch((err) =>
                    bus.emit('toast', { text: t('toast.createFailed', { title: name(e), error: errorText(err) }), error: true })
                  )
              }
        }),
      (err) => bus.emit('toast', { text: t('toast.deleteFailed', { title: name(e), error: errorText(err) }), error: true })
    )
  if (e.recurringEventId) bus.emit('scope:ask', { title: t('scope.delete'), danger: true, onPick: run, onCancel: () => {} })
  else run('one')
}

/**
 * Answers an invite, the same from the menu, the details popover and the invitations: a recurring one first asks for
 * this occurrence or the whole series. Resolves with the updated event, or null when the question was cancelled;
 * rejects when the reply failed (the caller shows it).
 */
export function respondEvent(e: CalEvent, status: Reply): Promise<CalEvent | null> {
  return new Promise((resolve, reject) => {
    const run = (scope: DeleteScope): void =>
      void selection.track(e, window.api.events.respond(e, status, scope === 'all' ? 'all' : 'one')).then(resolve, reject)
    if (e.recurringEventId) bus.emit('scope:ask', { title: t('scope.respond'), scopes: ['one', 'all'], onPick: run, onCancel: () => resolve(null) })
    else run('one')
  })
}

/** From the menu: a failed reply shows in a toast. */
const reply = (e: CalEvent, status: Reply): void =>
  void respondEvent(e, status).catch((err) => bus.emit('toast', { text: t('toast.respondFailed', { title: name(e), error: errorText(err) }), error: true }))

/**
 * Deletes or answers every picked event at once. With a recurring one among them, asks once which part of the series
 * goes for all of them. Runs one after another: occurrences of a CalDAV series share one object on the server.
 * ponytail: no Undo for a bulk change; one summary toast.
 */
function runBulk(events: CalEvent[], action: 'delete' | Reply): void {
  selection.clear()
  if (!events.length) return
  const del = action === 'delete'
  const run = async (scope: DeleteScope): Promise<void> => {
    const targets = bulkTargets(events, scope)
    const failed: unknown[] = []
    for (const e of targets) {
      await selection
        .track<unknown>(e, del ? window.api.events.delete(e, scope) : window.api.events.respond(e, action, scope === 'all' ? 'all' : 'one'))
        .catch((err: unknown) => void failed.push(err))
    }
    bus.emit(
      'toast',
      failed.length
        ? { text: t('toast.bulkFailed', { n: failed.length, total: targets.length, error: errorText(failed[0]) }), error: true }
        : { text: t(del ? 'toast.deletedMany' : 'toast.respondedMany', { n: targets.length }) }
    )
  }
  if (!events.some((e) => e.recurringEventId)) return void run('one')
  bus.emit('scope:ask', {
    title: t(del ? 'scope.deleteMany' : 'scope.respondMany'),
    ...(del ? { danger: true } : { scopes: ['one', 'all'] as DeleteScope[] }),
    onPick: (scope) => void run(scope),
    onCancel: () => {}
  })
}

/**
 * Recolours an event from the menu: a recurring event first asks for this one or the whole series. Undo puts back a
 * single one's colour (like a move, a series change has none).
 */
function recolor(e: CalEvent, colorId: string | null): void {
  if ((e.colorId ?? null) === colorId) return
  const run = (scope: DeleteScope): void =>
    void window.api.events.setColor(e, colorId, scope === 'all' ? 'all' : 'one').then(
      (updated) => {
        bus.emit('toast', {
          text: t(scope === 'all' ? 'toast.coloredAll' : 'toast.colored', { title: name(e) }),
          action:
            scope === 'all'
              ? undefined
              : {
                  label: t('common.undo'),
                  run: () =>
                    void window.api.events.setColor(updated, e.colorId ?? null, 'one').catch((err) =>
                      bus.emit('toast', { text: t('toast.colorFailed', { title: name(e), error: errorText(err) }), error: true })
                    )
                }
        })
      },
      (err) => bus.emit('toast', { text: t('toast.colorFailed', { title: name(e), error: errorText(err) }), error: true })
    )
  if (e.recurringEventId) bus.emit('scope:ask', { title: t('scope.color'), scopes: ['one', 'all'], onPick: run, onCancel: () => {} })
  else run('one')
}

interface Item {
  id: string
  label: string
  icon: React.JSX.Element
  danger?: boolean
  disabled?: boolean
  run: () => void
}

/** Right-click menu for events and free slots. Rendered once in the app shell. */
export function EventMenuHost(): React.JSX.Element | null {
  const { accounts, calendars } = useDirectory()
  useLocale()
  const [menu, setMenu] = useState<Opened | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // What had keyboard focus when the menu opened (an event pill, say); it gets it back when the menu closes. Only
  // :focus-visible counts: a right-click focuses the pill too, and a mouse user wants no ring and tooltip after.
  const back = useRef<Element | null>(null)

  useEffect(() => {
    const open = (m: Opened): void => {
      const was = document.activeElement
      if (!ref.current?.contains(was)) back.current = was?.matches(':focus-visible') ? was : null
      setMenu(m)
    }
    const offs = [
      bus.on('menu:event', (m) => open({ kind: 'event', ...m })),
      bus.on('menu:slot', (m) => open({ kind: 'slot', ...m }))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Unless the chosen item moved focus on (the editor, a prompt), or the element is gone (deleted).
  useEffect(() => {
    if (menu) return
    const el = back.current
    back.current = null
    if (el instanceof HTMLElement && el.isConnected && document.activeElement === document.body) el.focus({ preventScroll: true })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    const offScroll = onLaterScroll(close)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      offScroll()
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // Opens at the pointer, flipped back inside the window when it would spill over an edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return setPos(null)
    const { width, height } = el.getBoundingClientRect()
    const left = menu.x + width + 4 > window.innerWidth ? Math.max(4, menu.x - width) : menu.x
    const top = menu.y + height + 4 > window.innerHeight ? Math.max(4, menu.y - height) : menu.y
    setPos({ left, top })
  }, [menu])
  // Once placed: a still hidden (measuring) menu can't take focus.
  useLayoutEffect(() => {
    if (pos) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [pos])

  if (!menu) return null

  // 'colors': the event's colour swatches, one row of the menu.
  const items: (Item | 'sep' | 'colors')[] = []
  let calendarColor = ''
  const deletable = (e: CalEvent): boolean =>
    canEdit(
      e,
      accounts.find((a) => a.id === e.accountId),
      calendars.find((c) => c.accountId === e.accountId && c.id === e.calendarId)
    )
  const replies = (enabled: (s: Reply) => boolean, run: (s: Reply) => void): Item[] =>
    REPLIES.map(([s, label, icon]) => ({ id: `rsvp-${s}`, label: t(label), icon, disabled: !enabled(s), run: () => run(s) }))
  // Right-click on a picked event: the actions for all picked ones.
  const many = menu.kind === 'event' && selection.size() > 1 && selection.has(menu.event) ? selection.events() : null
  if (many) {
    const invites = many.filter((e) => e.myStatus)
    const gone = many.filter(deletable)
    items.push(
      ...replies(() => invites.length > 0, (s) => runBulk(invites, s)),
      'sep',
      { id: 'delete', label: t('menu.deleteMany', { n: gone.length || many.length }), icon: <DeleteIcon />, danger: true, disabled: !gone.length, run: () => runBulk(gone, 'delete') }
    )
  } else if (menu.kind === 'event') {
    const e = menu.event
    const account = accounts.find((a) => a.id === e.accountId)
    const calendar = calendars.find((c) => c.accountId === e.accountId && c.id === e.calendarId)
    const editable = canEdit(e, account, calendar)
    // A copy goes to the event's own calendar, so that calendar must take new events (an invite's does).
    const writable = !!account && !!calendar && !calendar.readOnly
    items.push(
      { id: 'edit', label: t('common.edit'), icon: <EditIcon />, disabled: !editable, run: () => bus.emit('event:edit', { event: e }) },
      { id: 'duplicate', label: t('menu.duplicate'), icon: <DuplicateIcon />, disabled: !writable, run: () => createCopy(e, undefined, 'toast.duplicated') },
      {
        id: 'copy',
        label: t('menu.copy'),
        icon: <CopyIcon />,
        disabled: !writable,
        run: () => {
          copied = e
          bus.emit('toast', { text: t('toast.copied', { title: name(e) }) })
        }
      },
      'sep'
    )
    // Not canEdit: an invitee may recolour its own copy too.
    if (writable) items.push('colors', 'sep')
    if (e.myStatus) items.push(...replies((s) => s !== e.myStatus, (s) => reply(e, s)), 'sep')
    items.push({ id: 'delete', label: t('common.delete'), icon: <DeleteIcon />, danger: true, disabled: !editable, run: () => deleteEvent(e) })
    calendarColor = eventColorOf({}, calendar, account)
  } else {
    const { slot, end } = menu
    const source = copied
    if (source) {
      items.push({ id: 'paste', label: t('menu.pasteEvent', { title: name(source) }), icon: <PasteIcon />, run: () => createCopy(source, slot, 'toast.pasted') })
    }
    items.push({
      id: 'new',
      label: t('common.newEvent'),
      icon: <NewIcon />,
      run: () => bus.emit('event:create', { start: slot.start, end, allDay: slot.allDay })
    })
  }

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    // The colour row is one stop (its checked swatch); ←/→ move inside it.
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([role=menuitemradio]), [aria-checked=true]') ?? [])]
    const active = document.activeElement
    const i = btns.indexOf((active?.closest('.ev-colors')?.querySelector('[aria-checked=true]') ?? active) as HTMLButtonElement)
    const n = btns.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n
    btns[next]?.focus()
  }

  return (
    <div
      ref={ref}
      className="ev-menu"
      role="menu"
      aria-label={menu.kind === 'event' ? t('menu.eventActions') : undefined}
      data-testid={menu.kind === 'event' ? 'event-menu' : 'slot-menu'}
      // Measured hidden first, then placed (see the layout effect).
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={`sep-${i}`} className="ev-menu-sep" role="separator" />
        ) : it === 'colors' ? (
          menu.kind === 'event' && (
            <EventColors
              key="colors"
              menu
              value={menu.event.colorId}
              calendarColor={calendarColor}
              onPick={(colorId) => {
                setMenu(null)
                recolor(menu.event, colorId)
              }}
            />
          )
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className={it.danger ? 'ev-menu-item danger' : 'ev-menu-item'}
            data-testid={`menu-${it.id}`}
            disabled={it.disabled}
            onClick={() => {
              setMenu(null)
              it.run()
            }}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        )
      )}
    </div>
  )
}

const AcceptIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)
const MaybeIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5" />
    <path d="M12 18.5h.01" />
  </Icon>
)
const DeclineIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)
const REPLIES: [Reply, Key, React.JSX.Element][] = [
  ['accepted', 'rsvp.accept', <AcceptIcon key="a" />],
  ['tentative', 'rsvp.maybe', <MaybeIcon key="m" />],
  ['declined', 'rsvp.decline', <DeclineIcon key="d" />]
]

const Icon = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <svg className="ev-menu-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
const EditIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
)
const DuplicateIcon = (): React.JSX.Element => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    <path d="M14 11v6M11 14h6" />
  </Icon>
)
const CopyIcon = (): React.JSX.Element => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
)
const PasteIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
  </Icon>
)
const NewIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
const DeleteIcon = (): React.JSX.Element => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
)
