/**
 * The desktop app's palettes (apps/desktop/src/renderer/src/theme.ts + styles/base.css), for the landing demos.
 * Kept in sync by apps/desktop/src/renderer/src/styles/themes-sync.test.ts.
 */
export const TOKENS = [
  'bg', 'surface', 'surface-2', 'hover', 'line', 'line-strong', 'fg', 'muted', 'faint', 'accent', 'pink', 'green', 'cyan', 'orange', 'red', 'yellow',
] as const
type Tokens = Record<(typeof TOKENS)[number], string>
const t = (list: string): Tokens => Object.fromEntries(list.split(', ').map((v, i) => [TOKENS[i], v])) as Tokens

export const THEMES: { id: string; name: string; scheme: 'dark' | 'light'; tokens: Tokens }[] = [
  { id: 'dracula', name: 'Dracula', scheme: 'dark', tokens: t('#0b0b10, #111118, #181822, #1d1d29, #1f1f2b, #2d2d3d, #f8f8f2, #6272a4, #3c4460, #bd93f9, #ff79c6, #50fa7b, #8be9fd, #ffb86c, #ff5555, #f1fa8c') },
  { id: 'tokyo', name: 'Tokyo Night', scheme: 'dark', tokens: t('#09090d, #101118, #171923, #1c1e2b, #1c1e2b, #2a2d42, #c0caf5, #565f89, #363b57, #7aa2f7, #bb9af7, #9ece6a, #7dcfff, #ff9e64, #f7768e, #e0af68') },
  { id: 'catppuccin', name: 'Catppuccin Mocha', scheme: 'dark', tokens: t('#0a0a10, #11111a, #191925, #20202f, #212132, #2f2f45, #cdd6f4, #6c7086, #45475a, #cba6f7, #f5c2e7, #a6e3a1, #89dceb, #fab387, #f38ba8, #f9e2af') },
  { id: 'amber', name: 'Phosphor amber', scheme: 'dark', tokens: t('#0a0806, #100d08, #18130c, #21190f, #241d12, #3a2f1c, #ffcc66, #8a6a33, #4d3b1d, #ffb000, #ff6a00, #9fd67a, #d4a24c, #ff9a3c, #ff4d2e, #ffe08a') },
  { id: 'mono', name: 'Black & White', scheme: 'dark', tokens: t('#000000, #0a0a0a, #111111, #1a1a1a, #1a1a1a, #2e2e2e, #fafafa, #8a8a8a, #404040, #ffffff, #ffffff, #e5e5e5, #d4d4d4, #bdbdbd, #ff5c5c, #fafafa') },
  { id: 'vscode', name: 'VS Code Dark', scheme: 'dark', tokens: t('#1f1f1f, #181818, #252526, #2a2d2e, #2b2b2b, #3c3c3c, #cccccc, #9d9d9d, #5a5a5a, #3794ff, #c586c0, #89d185, #4ec9b0, #ce9178, #f14c4c, #dcdcaa') },
  { id: 'matrix', name: 'Matrix', scheme: 'dark', tokens: t('#0a0a0a, #0f0f0f, #151515, #1b1b1b, #1e1e1e, #2c2c2c, #8fd99e, #4d8a5c, #2b4232, #3ecf68, #a8d66a, #35b85a, #6fcfa2, #c4cf62, #d9594c, #d2d98a') },
  { id: 'bubble', name: 'Bubblegum', scheme: 'light', tokens: t('#fff5fa, #ffeaf4, #ffffff, #ffdeee, #fcd6e8, #f6bdd9, #4a2a40, #9a6487, #eabfd5, #e0458f, #ff7ab8, #3fb68a, #5aa7dc, #f28a6b, #e04468, #e6ae3a') },
  { id: 'toon', name: 'Cartoon', scheme: 'light', tokens: t('#fffbea, #fff1bf, #ffffff, #ffe8a0, #f1e1a4, #2b2140, #2b2140, #6e5f8f, #cbb98a, #7b3ff2, #ff3d7f, #17b45a, #0ea5e9, #ff8a00, #f0263c, #f5c400') },
  { id: 'cloud', name: 'Cloud', scheme: 'light', tokens: t('#f2fefe, #e0ffff, #ffffff, #d2f6f7, #c8eff1, #9fdde2, #1d3b40, #55848b, #b3e3e7, #1f9fb0, #e98fb6, #36b08c, #5aa8e6, #f2a26c, #e15b6b, #e0b13f') },
  { id: 'light', name: 'Light', scheme: 'light', tokens: t('#ffffff, #f7f7f8, #ffffff, #f0f0f2, #e8e8eb, #d4d4d8, #18181b, #71717a, #d4d4d8, #2563eb, #db2777, #16a34a, #0891b2, #ea580c, #dc2626, #ca8a04') },
]

export type Theme = (typeof THEMES)[number]

/** Inline custom properties for one palette; light palettes also get white-on-accent and stronger event tints, as in the app. */
export const themeVars = (th: Theme): string =>
  TOKENS.map((k) => `--${k}: ${th.tokens[k]}`).join('; ') +
  (th.scheme === 'light' ? '; --on-accent: #ffffff; --ev-mix: 22%; --ev-text-mix: 40%' : '; --on-accent: var(--bg); --ev-mix: 15%; --ev-text-mix: 60%')
