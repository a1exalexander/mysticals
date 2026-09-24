import { useSyncExternalStore } from 'react'

/** Dark palettes defined in styles/base.css as :root[data-theme=…]. Preview colours: bg, accent, pink, cyan, green. */
export const THEMES = [
  { id: 'dracula', name: 'Dracula', preview: ['#0b0b10', '#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b'] },
  { id: 'tokyo', name: 'Tokyo Night', preview: ['#09090d', '#7aa2f7', '#bb9af7', '#7dcfff', '#9ece6a'] },
  { id: 'catppuccin', name: 'Catppuccin Mocha', preview: ['#0a0a10', '#cba6f7', '#f5c2e7', '#89dceb', '#a6e3a1'] },
  { id: 'amber', name: 'Phosphor amber', preview: ['#0a0806', '#ffb000', '#ff6a00', '#d4a24c', '#9fd67a'] }
] as const

export type ThemeId = (typeof THEMES)[number]['id']

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
  document.documentElement.dataset.theme = id
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
