import { useCallback, useSyncExternalStore } from 'react'
import { nearestEventColor } from '@mysticals/core/logic/colors'
import { t } from './i18n'

/**
 * Palettes defined in styles/base.css as :root[data-theme=…]. Preview colours: bg, accent, pink, cyan, green.
 * events: the theme's own versions of Google's 11 event colours, in EVENT_COLORS order (lavender, sage, grape, flamingo,
 * banana, tangerine, peacock, graphite, blueberry, basil, tomato), drawn instead of calendar colours when the theme
 * palette is on (Settings › Themes). Dracula, Tokyo Night, Catppuccin and VS Code use their published accents.
 */
export const THEMES = [
  { id: 'dracula', name: 'Dracula', scheme: 'dark', preview: ['#0b0b10', '#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b'],
    events: ['#bd93f9', '#50fa7b', '#d16bff', '#ff79c6', '#f1fa8c', '#ffb86c', '#8be9fd', '#6272a4', '#9580ff', '#c3ff3d', '#ff5555'] },
  { id: 'tokyo', name: 'Tokyo Night', scheme: 'dark', preview: ['#09090d', '#7aa2f7', '#bb9af7', '#7dcfff', '#9ece6a'],
    events: ['#bb9af7', '#73daca', '#9d7cd8', '#ff007c', '#e0af68', '#ff9e64', '#7dcfff', '#737aa2', '#7aa2f7', '#9ece6a', '#f7768e'] },
  { id: 'catppuccin', name: 'Catppuccin Mocha', scheme: 'dark', preview: ['#0a0a10', '#cba6f7', '#f5c2e7', '#89dceb', '#a6e3a1'],
    events: ['#b4befe', '#a6e3a1', '#cba6f7', '#eba0ac', '#f9e2af', '#fab387', '#74c7ec', '#9399b2', '#89b4fa', '#94e2d5', '#f38ba8'] },
  { id: 'amber', name: 'Phosphor amber', scheme: 'dark', preview: ['#0a0806', '#ffb000', '#ff6a00', '#d4a24c', '#9fd67a'],
    events: ['#ffc999', '#d4c25c', '#e0a030', '#ff8a4c', '#ffe08a', '#ff6a00', '#e6d3a3', '#95753e', '#c98a1e', '#b8a040', '#ff4d2e'] },
  { id: 'mono', name: 'Black & White', scheme: 'dark', preview: ['#000000', '#ffffff', '#a3a3a3', '#5c5c5c', '#2e2e2e'],
    events: ['#c1c1c1', '#dcdcdc', '#818181', '#b4b4b4', '#f8f8f8', '#9a9a9a', '#cfcfcf', '#747474', '#8d8d8d', '#eaeaea', '#a7a7a7'] },
  { id: 'vscode', name: 'VS Code Dark', scheme: 'dark', preview: ['#1f1f1f', '#3794ff', '#c586c0', '#4ec9b0', '#6a9955'],
    events: ['#b180d7', '#4ec9b0', '#c586c0', '#d16969', '#dcdcaa', '#ce9178', '#9cdcfe', '#808080', '#569cd6', '#6a9955', '#f44747'] },
  { id: 'matrix', name: 'Matrix', scheme: 'dark', preview: ['#0a0a0a', '#3ecf68', '#a8d66a', '#6fcfa2', '#35b85a'],
    events: ['#7fd8be', '#6fcf8f', '#4fae8a', '#b6e37d', '#d8f08a', '#9fd648', '#43d6b0', '#5c7a64', '#2fa37a', '#35b85a', '#c8ff6a'] },
  { id: 'bubble', name: 'Bubblegum', scheme: 'light', preview: ['#fff5fa', '#c92d7b', '#d0246c', '#ffa3d1', '#cfeeff'],
    events: ['#b8b5ff', '#8fe3c0', '#c9a7ff', '#ff8fc8', '#ffe680', '#ffb38a', '#8fd3ff', '#b9aec9', '#8fa8ff', '#b5e48c', '#ff6f91'] },
  { id: 'toon', name: 'Cartoon', scheme: 'light', preview: ['#fffbea', '#7b3ff2', '#d0105f', '#18b6f6', '#ffd60a'],
    events: ['#9b6bff', '#2ecc71', '#7b3ff2', '#ff5fa2', '#ffd60a', '#ff8a1a', '#18b6f6', '#8c7fa8', '#3d6bff', '#12a594', '#f0263c'] },
  { id: 'cloud', name: 'Cloud', scheme: 'light', preview: ['#f2fefe', '#137d8b', '#e0ffff', '#f7c3d9', '#b4ebd9'],
    events: ['#a9b8f0', '#8fdcc4', '#c7a6e6', '#f7a3c4', '#f3d77a', '#f6b48a', '#7cc8ec', '#9ab3b8', '#6fa3e0', '#a3d977', '#ef7a8a'] },
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

/** A colour in the current theme's event palette (nearest of its 11 slots), or as is with the palette off. */
export const themedColor = (hex: string, id: ThemeId, p: EventPalette): string => {
  if (p !== 'theme' || !/^#[\da-f]{6}$/i.test(hex)) return hex
  return (THEMES.find((x) => x.id === id) ?? THEMES[0]).events[nearestEventColor(hex)]
}

/** themedColor bound to the current theme and palette; a new function whenever either changes. */
export function useThemedColor(): (hex: string) => string {
  const id = useTheme()
  const p = useEventPalette()
  return useCallback((hex: string) => themedColor(hex, id, p), [id, p])
}
