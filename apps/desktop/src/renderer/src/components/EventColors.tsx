import { useState } from 'react'
import { EVENT_COLORS } from '@mysticals/core/logic/colors'
import { rovingIndex } from './ui/roving'
import { t } from '../i18n'
import { useEventPalette, useThemedColor } from '../theme'
import './EventColors.css'

/**
 * An event's colour choices: its calendar's own colour, then the 11 event colours. ←/→ (Home/End) move between them,
 * a click / Enter / Space picks one: picking writes to the server, so moving through them must not. In the right-click
 * menu they are menuitemradios that the menu reaches as one stop; elsewhere one Tab stop with pressed buttons. With the
 * theme palette on, each swatch is split: the theme's colour on top, the original below.
 */
export function EventColors({
  value = '',
  calendarColor,
  menu,
  onPick
}: {
  /** The chosen colorId; none (or '') is the calendar's own colour. */
  value?: string
  calendarColor: string
  menu?: boolean
  onPick: (colorId: string | null) => void
}): React.JSX.Element {
  const options = [
    { id: '', hex: calendarColor, label: t('eventColor.default') },
    ...EVENT_COLORS.map((c) => ({ id: c.id as string, hex: c.hex as string, label: t(`eventColor.${c.key}`) }))
  ]
  const themed = useThemedColor()
  const split = useEventPalette() === 'theme'
  const [focused, setFocused] = useState<number>()
  const stop = focused ?? Math.max(0, options.findIndex((o) => o.id === value))
  return (
    <div
      className="ev-colors"
      role="group"
      aria-label={t('eventColor.label')}
      data-testid="event-colors"
      onKeyDown={(e) => {
        // In the menu, Home/End stay the menu's (first/last item).
        if (menu && (e.key === 'Home' || e.key === 'End')) return
        const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
        const next = rovingIndex(e.key, all.indexOf(document.activeElement as HTMLButtonElement), all.length, false)
        if (next < 0) return
        e.preventDefault()
        e.stopPropagation()
        all[next]?.focus()
      }}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(undefined)}
    >
      {options.map((o, i) => (
        <button
          key={o.id || 'calendar'}
          type="button"
          role={menu ? 'menuitemradio' : undefined}
          aria-checked={menu ? o.id === value : undefined}
          aria-pressed={menu ? undefined : o.id === value}
          aria-label={o.label}
          title={o.label}
          tabIndex={menu ? -1 : i === stop ? 0 : -1}
          className={`ev-swatch${o.id ? '' : ' calendar'}${split ? ' split' : ''}`}
          data-color={o.id || 'calendar'}
          style={{ '--sw': o.hex, '--sw-th': themed(o.hex) } as React.CSSProperties}
          onFocus={() => setFocused(i)}
          onClick={() => onPick(o.id || null)}
        />
      ))}
    </div>
  )
}
