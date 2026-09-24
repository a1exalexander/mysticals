import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CalEvent } from '@shared/types'
import { bus } from '../bus'
import { meetingUrl } from '@mysticals/core/logic/meeting'
import { placeTip } from './EventTooltip.logic'
import './EventTooltip.css'

const SHOW_MS = 1000
const HIDE_MS = 150

interface Tip { url: string; anchor: DOMRect }

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

/** Spread onto an event pill: shows its meeting link after a 1s hover. No URL → no handlers. */
export function tooltipHover(event: CalEvent): Pick<React.HTMLAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave'> {
  const url = meetingUrl(event.location)
  if (!url) return {}
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
      showTimer = setTimeout(() => el.isConnected && setTip({ url, anchor: el.getBoundingClientRect() }), SHOW_MS)
    },
    onMouseLeave: hideSoon
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
      <a href={tip.url} target="_blank" rel="noreferrer" onClick={hide}>
        {tip.url}
      </a>
    </div>
  )
}
