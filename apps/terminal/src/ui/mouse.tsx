/**
 * Mouse support. cli.ts turns on xterm mouse reporting (modes 1000 + 1006) inside the alternate screen, so reports
 * arrive through Ink's input stream as "[<b;x;y" + "M" (press) / "m" (release), with 1-based screen cells.
 * The app fills the alternate screen from row 1, so Yoga layout offsets map 1:1 onto screen cells.
 *
 *   <MouseProvider> once near the root; <Clickable onClick onWheel> anywhere below it (outside one it is a plain Box).
 *   A click or wheel goes to the smallest region under the pointer that handles it.
 *   useKeys = Ink's useInput minus mouse reports; use it instead of useInput so reports never reach key handlers.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { C } from './theme'
import { Box, Text, useInput, useStdin, type BoxProps, type DOMElement, type Key } from 'ink'

const REPORT = /^\[<(\d+);(\d+);(\d+)([Mm])$/

export const isMouse = (input: string): boolean => REPORT.test(input)

/** Ink's useInput, skipping mouse reports. */
export function useKeys(handler: (input: string, key: Key) => void, options?: { isActive?: boolean }): void {
  // Ink re-subscribes a new handler in a passive effect, after the render; a key right behind the one that changed
  // state (fast typing, paste, a slow machine) would hit the old closure. Call the latest committed handler instead.
  const latest = useRef(handler)
  useLayoutEffect(() => void (latest.current = handler))
  const stable = useCallback((input: string, key: Key) => {
    if (!isMouse(input)) latest.current(input, key)
  }, [])
  useInput(stable, options)
}

type Handlers = { onClick?(): void; onWheel?(dir: 1 | -1): void }
type Region = { node: { current: DOMElement | null }; handlers: { current: Handlers } }

const Regions = createContext<Set<Region> | null>(null)

/** Absolute cell rectangle of a rendered element (sum of Yoga offsets up to the root). */
function rect(el: DOMElement): { x: number; y: number; w: number; h: number } | undefined {
  if (!el.yogaNode) return
  let x = 0
  let y = 0
  for (let n: DOMElement | undefined = el; n?.yogaNode; n = n.parentNode) {
    x += n.yogaNode.getComputedLeft()
    y += n.yogaNode.getComputedTop()
  }
  return { x, y, w: el.yogaNode.getComputedWidth(), h: el.yogaNode.getComputedHeight() }
}

function Dispatcher({ regions }: { regions: Set<Region> }) {
  // Piped stdin has no raw mode (and no mouse); useInput would throw enabling it.
  const { isRawModeSupported } = useStdin()
  useInput((input) => {
    const m = REPORT.exec(input)
    if (!m || m[4] !== 'M') return
    const b = Number(m[1])
    const x = Number(m[2]) - 1
    const y = Number(m[3]) - 1
    // bits: 0-1 button, 4/8/16 modifiers, 32 motion, 64 wheel
    const wheel = b & 64 ? ((b & 1) === 0 ? -1 : 1) : 0
    if (!wheel && (b & ~(4 | 8 | 16)) !== 0) return // only plain left presses and wheel
    let best: { h: Handlers; area: number } | undefined
    for (const r of regions) {
      const h = r.handlers.current
      if (!(wheel ? h.onWheel : h.onClick) || !r.node.current) continue
      const box = rect(r.node.current)
      if (!box || x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h) continue
      if (!best || box.w * box.h < best.area) best = { h, area: box.w * box.h }
    }
    if (wheel) best?.h.onWheel?.(wheel)
    else best?.h.onClick?.()
  }, { isActive: isRawModeSupported === true })
  return null
}

export function MouseProvider({ children }: { children: ReactNode }) {
  const regions = useRef(new Set<Region>()).current
  return (
    <Regions.Provider value={regions}>
      <Dispatcher regions={regions} />
      {children}
    </Regions.Provider>
  )
}

/** A Box that receives clicks / wheel over its area. */
export function Clickable({ onClick, onWheel, children, ...box }: BoxProps & Handlers & { children?: ReactNode }) {
  const node = useRef<DOMElement>(null)
  const handlers = useRef<Handlers>({})
  handlers.current = { onClick, onWheel }
  const regions = useContext(Regions)
  useEffect(() => {
    if (!regions) return
    const r: Region = { node, handlers }
    regions.add(r)
    return () => void regions.delete(r)
  }, [regions])
  return (
    <Box ref={node} {...box}>
      {children}
    </Box>
  )
}

/** Key hint that is also a click target: the key as a colored keycap, then the label. */
export function Button({ k, label, onPress, color = C.accent }: { k: string; label: string; onPress(): void; color?: string }) {
  return (
    <Clickable onClick={onPress} marginRight={2} flexShrink={0}>
      <Text>
        <Text inverse color={color} bold>{k}</Text> {label}
      </Text>
    </Clickable>
  )
}
