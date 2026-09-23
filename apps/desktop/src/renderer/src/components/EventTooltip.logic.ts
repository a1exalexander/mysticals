interface Box { top: number; bottom: number; left: number }
interface Size { w: number; h: number }

/** Below the anchor, or above if it doesn't fit; always clamped inside the viewport. */
export function placeTip(a: Box, tip: Size, vp: Size, gap = 4): { top: number; left: number } {
  const below = a.bottom + gap
  const top = below + tip.h <= vp.h - gap ? below : a.top - gap - tip.h
  const clamp = (v: number, max: number): number => Math.max(gap, Math.min(v, max - gap))
  return { top: clamp(top, vp.h - tip.h), left: clamp(a.left, vp.w - tip.w) }
}
