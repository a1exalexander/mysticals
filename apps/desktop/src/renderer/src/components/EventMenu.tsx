import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CalEvent, DeleteScope } from '@shared/types'
import { bus, type BusEvents } from '../bus'
import { useDirectory } from './ui/useDirectory'
import { canEdit, formatWhen } from '@mysticals/core/logic/details'
import { errorText } from '@mysticals/core/logic/editor'
import { copyInput, type PasteSlot } from '@mysticals/core/logic/copy'
import { currentLocale, t, useLocale } from '../i18n'
import './EventMenu.css'

type Opened = ({ kind: 'event' } & BusEvents['menu:event']) | ({ kind: 'slot' } & BusEvents['menu:slot'])

/** The event "Copy" put aside for "Paste" on a free time or day; app-wide, lives while the app runs. */
let copied: CalEvent | null = null

const name = (e: CalEvent): string => e.title || t('common.untitled')

/** Spread onto an event pill: right-click opens its menu (instead of the window's native one). */
export function eventMenu(event: CalEvent): Pick<React.HTMLAttributes<HTMLElement>, 'onContextMenu'> {
  return {
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
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
    'aria-label': `${name(event)}, ${formatWhen(event, currentLocale())}`,
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
        action: { label: t('common.undo'), run: () => void window.api.events.delete(made, 'one').catch(() => {}) }
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
    void window.api.events.delete(e, scope).then(
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
    if (el instanceof HTMLElement && el.isConnected && document.activeElement === document.body) el.focus()
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
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
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

  const items: (Item | 'sep')[] = []
  if (menu.kind === 'event') {
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
      'sep',
      { id: 'delete', label: t('common.delete'), icon: <DeleteIcon />, danger: true, disabled: !editable, run: () => deleteEvent(e) }
    )
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
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
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
