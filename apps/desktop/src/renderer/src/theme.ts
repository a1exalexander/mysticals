import { useSyncExternalStore } from 'react'
import { t } from './i18n'

/** Palettes defined in styles/base.css as :root[data-theme=…]. Preview colours: bg, accent, pink, cyan, green. */
export const THEMES = [
  { id: 'dracula', name: 'Dracula', scheme: 'dark', preview: ['#0b0b10', '#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b'] },
  { id: 'tokyo', name: 'Tokyo Night', scheme: 'dark', preview: ['#09090d', '#7aa2f7', '#bb9af7', '#7dcfff', '#9ece6a'] },
  { id: 'catppuccin', name: 'Catppuccin Mocha', scheme: 'dark', preview: ['#0a0a10', '#cba6f7', '#f5c2e7', '#89dceb', '#a6e3a1'] },
  { id: 'amber', name: 'Phosphor amber', scheme: 'dark', preview: ['#0a0806', '#ffb000', '#ff6a00', '#d4a24c', '#9fd67a'] },
  { id: 'mono', name: 'Black & White', scheme: 'dark', preview: ['#000000', '#ffffff', '#a3a3a3', '#5c5c5c', '#2e2e2e'] },
  { id: 'vscode', name: 'VS Code Dark', scheme: 'dark', preview: ['#1f1f1f', '#3794ff', '#c586c0', '#4ec9b0', '#6a9955'] },
  { id: 'bubble', name: 'Bubblegum', scheme: 'light', preview: ['#fff5fa', '#e0458f', '#ffa3d1', '#b9a6ff', '#9fe3c9'] },
  { id: 'toon', name: 'Cartoon', scheme: 'light', preview: ['#fffbea', '#7b3ff2', '#ff3d7f', '#18b6f6', '#ffd60a'] }
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Proper names stay as they are; only the descriptive ones are translated. */
export const themeName = (th: (typeof THEMES)[number]): string =>
  th.id === 'amber' ? t('theme.amber') : th.id === 'mono' ? t('theme.mono') : th.id === 'toon' ? t('theme.toon') : th.name

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

export const useTheme = (): ThemeId =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => current
  )
