/**
 * Colors are the terminal's own: ANSI names, so the user's theme decides the actual shades (and NO_COLOR turns them
 * off). Highlights use `inverse`, which swaps the theme's own foreground and background.
 */
export const C = {
  red: 'red',
  green: 'green',
  yellow: 'yellow',
  blue: 'blue',
  magenta: 'magenta',
  cyan: 'cyan',
  /** Active tab, keycaps, focus. */
  accent: 'magenta',
  /** Current time: clock labels, now-lines, today. */
  now: 'red',
  /** Secondary text. */
  muted: 'gray'
} as const

/**
 * Nearest ANSI color for a calendar/account hex color, so events follow the terminal theme too.
 * Hue buckets; orange and pink take the bright variants so the default account palette stays distinct.
 */
export function ansiOf(hex: string): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!m) return C.muted
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d < 0.15) return max > 0.8 ? 'white' : C.muted
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
  if (h < 15 || h >= 345) return 'red'
  if (h < 45) return 'yellowBright' // orange
  if (h < 75) return 'yellow'
  if (h < 165) return 'green'
  if (h < 200) return 'cyan'
  if (h < 250) return 'blue'
  if (h < 300) return 'magenta'
  return 'magentaBright' // pink
}
