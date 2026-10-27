import { useCallback, useSyncExternalStore } from 'react'
import { EVENT_COLORS, nearestEventColor, type EventColor } from '@mysticals/core/logic/colors'
import { t } from './i18n'

/**
 * Palettes defined in styles/base.css as :root[data-theme=…]. Preview colours: bg, accent, pink, cyan, green.
 * events: the theme's own versions of Google's 11 event colours, in EVENT_COLORS order (lavender, sage, grape, flamingo,
 * banana, tangerine, peacock, graphite, blueberry, basil, tomato), drawn instead of calendar colours when the theme
 * palette is on (Settings › Themes). Tokyo Night takes its Moon variant's accents, VS Code One Dark Pro's, Cartoon Riso
 * inks; Dracula goes gothic (blood, wine, candle gold), Catppuccin aurora, Bubblegum pinks only, Cloud blues only, ARC Raiders
 * its logo stripes (cyan, green, yellow, red) and gold on dusty 70s hues.
 */
export const THEMES = [
  { id: 'dracula', name: 'Dracula', scheme: 'dark', preview: ['#0b0b10', '#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b'],
    events: ['#b9a3e3', '#9cc59a', '#b44fd1', '#e88aa8', '#e9c46a', '#e07b4f', '#7fb4c8', '#8a8199', '#6f73d6', '#5aa37a', '#d9344f'] },
  { id: 'tokyo', name: 'Tokyo Night', scheme: 'dark', preview: ['#09090d', '#7aa2f7', '#bb9af7', '#7dcfff', '#9ece6a'],
    events: ['#c099ff', '#4fd6be', '#fca7ea', '#ff757f', '#ffc777', '#ff966c', '#86e1fc', '#636da6', '#82aaff', '#c3e88d', '#ff007c'] },
  { id: 'catppuccin', name: 'Catppuccin Mocha', scheme: 'dark', preview: ['#0a0a10', '#cba6f7', '#f5c2e7', '#89dceb', '#a6e3a1'],
    events: ['#b4a7f5', '#8ff0c8', '#c88cf2', '#f59ad0', '#e8f09a', '#f7b27a', '#6fe0ee', '#8c93ad', '#7ea4f7', '#6fd99a', '#f57a9a'] },
  { id: 'amber', name: 'Phosphor amber', scheme: 'dark', preview: ['#0a0806', '#ffb000', '#ff6a00', '#d4a24c', '#9fd67a'],
    events: ['#ffc999', '#d4c25c', '#e0a030', '#ff8a4c', '#ffe08a', '#ff6a00', '#e6d3a3', '#95753e', '#c98a1e', '#b8a040', '#ff4d2e'] },
  { id: 'mono', name: 'Black & White', scheme: 'dark', preview: ['#000000', '#ffffff', '#a3a3a3', '#5c5c5c', '#2e2e2e'],
    events: ['#c1c1c1', '#dcdcdc', '#818181', '#b4b4b4', '#f8f8f8', '#9a9a9a', '#cfcfcf', '#747474', '#8d8d8d', '#eaeaea', '#a7a7a7'] },
  { id: 'vscode', name: 'VS Code Dark', scheme: 'dark', preview: ['#1f1f1f', '#3794ff', '#c586c0', '#4ec9b0', '#6a9955'],
    events: ['#b294e8', '#98c379', '#c678dd', '#f0a0b0', '#e5c07b', '#d19a66', '#56b6c2', '#7f848e', '#61afef', '#4fa66a', '#e06c75'] },
  { id: 'matrix', name: 'Matrix', scheme: 'dark', preview: ['#0a0a0a', '#3ecf68', '#a8d66a', '#6fcfa2', '#35b85a'],
    events: ['#7fd8be', '#6fcf8f', '#4fae8a', '#b6e37d', '#d8f08a', '#9fd648', '#43d6b0', '#5c7a64', '#2fa37a', '#35b85a', '#c8ff6a'] },
  { id: 'arc', name: 'ARC Raiders', scheme: 'dark', preview: ['#0d0c0a', '#f1aa1c', '#ff5b3d', '#33c3e0', '#9ccf4a'],
    events: ['#a99bd6', '#a9c08a', '#b07cc6', '#e8907a', '#ffd23f', '#f7811e', '#33c3e0', '#8a8170', '#5b8fd9', '#6fae4a', '#ff4f3d'] },
  { id: 'bubble', name: 'Bubblegum', scheme: 'light', preview: ['#fff5fa', '#c92d7b', '#d0246c', '#ffa3d1', '#cfeeff'],
    events: ['#dcabd6', '#cc939a', '#871459', '#ee83af', '#fcd4e6', '#dd6d79', '#d740a2', '#846875', '#a13b85', '#681d3b', '#d4225f'] },
  { id: 'toon', name: 'Cartoon', scheme: 'light', preview: ['#fffbea', '#7b3ff2', '#d0105f', '#18b6f6', '#ffd60a'],
    events: ['#765ba7', '#00a95c', '#9d7ad2', '#ff48b0', '#ffe800', '#ff6c2f', '#5ec8e5', '#88898a', '#3255a4', '#00838a', '#f15060'] },
  { id: 'cloud', name: 'Cloud', scheme: 'light', preview: ['#f2fefe', '#137d8b', '#e0ffff', '#f7c3d9', '#b4ebd9'],
    events: ['#9dafe5', '#8fd0e1', '#294793', '#67addd', '#c6e8f6', '#3699b8', '#28acdf', '#617581', '#145ec1', '#014867', '#137ece'] },
  { id: 'light', name: 'Light', scheme: 'light', preview: ['#ffffff', '#111111', '#525252', '#a3a3a3', '#e5e5e5'],
    events: ['#3c3c3c', '#585858', '#222222', '#454545', '#767676', '#333333', '#626262', '#808080', '#2a2a2a', '#4e4e4e', '#6c6c6c'] }
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Proper names stay as they are; only the descriptive ones are translated. */
const TRANSLATED = {
  amber: 'theme.amber',
  mono: 'theme.mono',
  toon: 'theme.toon',
  cloud: 'theme.cloud',
  light: 'theme.light'
} as const satisfies Partial<Record<ThemeId, string>>

export const themeName = (th: (typeof THEMES)[number]): string =>
  th.id in TRANSLATED ? t(TRANSLATED[th.id as keyof typeof TRANSLATED]) : th.name

const KEY = 'mysticals-theme'
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)

function read(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    if (isTheme(v)) return v
  } catch {
    // storage unavailable: fall back to default
  }
  return 'dracula'
}

let current = read()
const subs = new Set<() => void>()

export function applyTheme(id: ThemeId = current): void {
  current = id
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]
  document.documentElement.dataset.theme = id
  document.documentElement.dataset.scheme = t.scheme
  // Absent in unit tests and plain-browser previews.
  void window.appTheme?.set(t.scheme, t.preview[0]).catch(() => {})
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // per-device preference only; ignore
  }
  subs.forEach((f) => f())
}

/** `storage` listener: follows a theme picked in another window (Settings while the full-screen reminder is open). */
export const followTheme = (e: StorageEvent): void => {
  if (e.key === KEY && isTheme(e.newValue) && e.newValue !== current) applyTheme(e.newValue)
  if (e.key === PALETTE_KEY && isPalette(e.newValue) && e.newValue !== palette) applyEventPalette(e.newValue)
}

export const useTheme = (): ThemeId =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => current
  )

/** How events are coloured: a soft tint of the canvas (opacity) or a solid fill. base.css reads html[data-fill]. */
export const EVENT_FILLS = ['opacity', 'fill'] as const
export type EventFill = (typeof EVENT_FILLS)[number]

const FILL_KEY = 'mysticals-event-fill'

function readFill(): EventFill {
  try {
    const v = localStorage.getItem(FILL_KEY)
    if (EVENT_FILLS.includes(v as EventFill)) return v as EventFill
  } catch {
    // storage unavailable: fall back to default
  }
  return 'opacity'
}

let fill = readFill()

export function applyEventFill(v: EventFill = fill): void {
  fill = v
  document.documentElement.dataset.fill = v
  try {
    localStorage.setItem(FILL_KEY, v)
  } catch {
    // per-device preference only; ignore
  }
  subs.forEach((f) => f())
}

export const useEventFill = (): EventFill =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => fill
  )

/** Where event colours come from: the calendar's own (default) or the theme's palette (THEMES[].events). */
export const EVENT_PALETTES = ['calendar', 'theme'] as const
export type EventPalette = (typeof EVENT_PALETTES)[number]

const PALETTE_KEY = 'mysticals-event-palette'
const isPalette = (v: unknown): v is EventPalette => EVENT_PALETTES.includes(v as EventPalette)

function readPalette(): EventPalette {
  try {
    const v = localStorage.getItem(PALETTE_KEY)
    if (isPalette(v)) return v
  } catch {
    // storage unavailable: fall back to default
  }
  return 'calendar'
}

let palette = readPalette()

/** base.css reads html[data-palette] to loosen the monochrome themes' chroma cap for their own palette. */
export function applyEventPalette(v: EventPalette = palette): void {
  palette = v
  document.documentElement.dataset.palette = v
  try {
    localStorage.setItem(PALETTE_KEY, v)
  } catch {
    // per-device preference only; ignore
  }
  subs.forEach((f) => f())
}

export const useEventPalette = (): EventPalette =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => palette
  )

/**
 * The app's own account swatches (SWATCHES in components/AccountsShared.tsx), slotted by hand: by nearest hue, pink and
 * purple would share grape and orange and yellow banana.
 */
export const SWATCH_SLOTS: Record<string, EventColor['key']> = {
  '#bd93f9': 'lavender',
  '#50fa7b': 'sage',
  '#8be9fd': 'peacock',
  '#ff79c6': 'flamingo',
  '#ffb86c': 'tangerine',
  '#f1fa8c': 'banana',
  '#ff5555': 'tomato',
  '#6272a4': 'graphite'
}

/** A colour in the current theme's event palette (nearest of its 11 slots), or as is with the palette off. */
export const themedColor = (hex: string, id: ThemeId, p: EventPalette): string => {
  if (p !== 'theme' || !/^#[\da-f]{6}$/i.test(hex)) return hex
  const swatch = SWATCH_SLOTS[hex.toLowerCase()]
  const slot = swatch ? EVENT_COLORS.findIndex((c) => c.key === swatch) : nearestEventColor(hex)
  return (THEMES.find((x) => x.id === id) ?? THEMES[0]).events[slot]
}

/** themedColor bound to the current theme and palette; a new function whenever either changes. */
export function useThemedColor(): (hex: string) => string {
  const id = useTheme()
  const p = useEventPalette()
  return useCallback((hex: string) => themedColor(hex, id, p), [id, p])
}
