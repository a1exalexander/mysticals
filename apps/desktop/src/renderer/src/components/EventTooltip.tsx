import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { eventMeetingUrl } from '@mysticals/core/logic/meeting'
import { formatWhen } from '@mysticals/core/logic/details'
import { placeTip } from './EventTooltip.logic'
import { currentLocale, t } from '../i18n'
import './EventTooltip.css'

const SHOW_MS = 1000
const HIDE_MS = 150

interface Tip { event: CalEvent; anchor: DOMRect }

let setTip: (t: Tip | null) => void = () => {}
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined

const hide = (): void => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  setTip(null)
}
// Scroll moves the anchor: drop a shown tip, but keep a pending one (it measures the pill when it fires).
const hideShown = (): void => {
  clearTimeout(hideTimer)
  setTip(null)
}
const hideSoon = (): void => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hide, HIDE_MS)
}

/** Spread onto an event pill: shows its title, time and meeting link after a 1s hover or keyboard focus. */
export function tooltipHover(event: CalEvent): Pick<React.HTMLAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur'> {
  const show = (el: HTMLElement): void => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    // not over the other pills a dragged event passes
    showTimer = setTimeout(() => el.isConnected && !document.body.dataset.dragging && setTip({ event, anchor: el.getBoundingClientRect() }), SHOW_MS)
  }
  return {
    onMouseEnter: (e) => show(e.currentTarget),
    onMouseLeave: hideSoon,
    // Keyboard focus only: a click focuses the pill too, and opens its details.
    onFocus: (e) => e.currentTarget.matches(':focus-visible') && show(e.currentTarget),
    onBlur: hideSoon
  }
}

/** Rendered once in the app shell. */
export function EventTooltipHost(): React.JSX.Element | null {
  const [tip, set] = useState<Tip | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    setTip = set
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) hide()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', hideShown, true)
    window.addEventListener('keydown', onKey)
    const off = bus.on('event:open', hide)
    return () => {
      hide()
      setTip = () => {}
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', hideShown, true)
      window.removeEventListener('keydown', onKey)
      off()
    }
  }, [])

  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    setPos(placeTip(tip.anchor, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight }))
  }, [tip])

  if (!tip) return null
  const url = eventMeetingUrl(tip.event)
  return (
    <div
      ref={ref}
      className="ett"
      data-testid="event-tooltip"
      role="tooltip"
      style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
      onMouseEnter={() => clearTimeout(hideTimer)}
      onMouseLeave={hideSoon}
    >
      <div className="ett-title">{tip.event.title || t('common.untitled')}</div>
      <div className="ett-when">{formatWhen(tip.event, currentLocale())}</div>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" onClick={hide}>
          {url}
        </a>
      )}
    </div>
  )
}
