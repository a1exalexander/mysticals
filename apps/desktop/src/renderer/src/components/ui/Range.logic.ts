/** `n` clamped to [min, max] and rounded to the nearest `step` above `min`. */
export function snap(n: number, min: number, max: number, step: number): number {
  const v = Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step + min
  // Strips float noise like 6.499999 from the step arithmetic.
  return Math.min(max, Number(v.toFixed(6)))
}

/** Where `v` sits on the track, 0–100. */
export const pct = (v: number, min: number, max: number): number => (max > min ? ((v - min) / (max - min)) * 100 : 0)

/** The snapped value under a pointer at `x` over a track spanning `left`..`left + width`. */
export function valueFromPointer(x: number, left: number, width: number, min: number, max: number, step: number): number {
  const f = width > 0 ? (x - left) / width : 0
  return snap(min + f * (max - min), min, max, step)
}

/** The value a key moves to, or null for keys the slider ignores. PageUp/PageDown move `big`. */
export function keyStep(key: string, v: number, min: number, max: number, step: number, big: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return snap(v + step, min, max, step)
    case 'ArrowLeft':
    case 'ArrowDown':
      return snap(v - step, min, max, step)
    case 'PageUp':
      return snap(v + big, min, max, step)
    case 'PageDown':
      return snap(v - big, min, max, step)
    case 'Home':
      return min
    case 'End':
      return max
    default:
      return null
  }
}
