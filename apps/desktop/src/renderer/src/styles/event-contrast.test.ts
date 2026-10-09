import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../theme'
import { SWATCHES } from '../components/AccountsShared'

// Event colours are whatever the provider sends; .ev in base.css derives the bar/tint/title through --ink.
// This mirrors that maths per theme and checks every colour stays legible (WCAG: 3:1 for the bar, 4.5:1 for titles).
// ponytail: gamut mapping is a chroma binary search, close to but not exactly Chromium's CSS Color 4 algorithm.
const css = readFileSync(join(__dirname, 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const GOOGLE = ['#d50000', '#e67c73', '#f4511e', '#f6bf26', '#33b679', '#0b8043', '#039be5', '#3f51b5', '#7986cb', '#8e24aa', '#616161']
const CLASSIC = ['#ac725e', '#d06b64', '#f83a22', '#fa573c', '#ff7537', '#ffad46', '#42d692', '#16a765', '#7bd148', '#b3dc6c', '#fbe983', '#fad165',
  '#92e1c0', '#9fe1e7', '#9fc6e7', '#4986e7', '#9a9cff', '#b99aff', '#c2c2c2', '#cabdbf', '#cca6ac', '#f691b2', '#cd74e6', '#a47ae2']
const COLOURS = [...SWATCHES, ...GOOGLE, ...CLASSIC, '#8e8e93', '#4285f4']

/** Custom properties on <html> for a theme: every `:root…` rule that matches, in source order. */
const vars = (id: string, scheme: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const hits = sel.split(/,(?![^(]*\))/).some((s) => {
      s = s.trim()
      if (!/^:root(\[[^\]]+\]|:is\([^)]*\))*$/.test(s)) return false
      return s === ':root' || s.includes(`'${id}'`) || (scheme === 'light' && s.includes(`data-scheme='light'`))
    })
    if (hits) for (const [, k, v] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[k] = v.trim()
  }
  return out
}

type RGB = number[]
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const gam = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const toLch = (c: RGB): number[] => {
  const [r, g, b] = c.map(lin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A)]
}
const fromLch = (L: number, C: number, h: number): RGB => {
  const lab = (c: number): RGB => {
    const a = c * Math.cos(h), b = c * Math.sin(h)
    const [l, m, s] = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3)
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  }
  const ok = (c: number): boolean => lab(c).every((v) => v >= -1e-4 && v <= 1 + 1e-4)
  let lo = 0, hi = C
  if (!ok(C)) for (let i = 0; i < 24; i++) ok((lo + hi) / 2) ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2)
  return lab(ok(C) ? C : lo).map((v) => Math.min(1, Math.max(0, gam(v))))
}
const mix = (a: RGB, b: RGB, p: number): RGB => a.map((v, i) => v * p + b[i] * (1 - p))
const lum = (c: RGB): number => { const [r, g, b] = c.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a: RGB, b: RGB): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('event colours', () => {
  it.each(THEMES.map((th) => [th.id, th.scheme]))('%s keeps every calendar colour legible', (id, scheme) => {
    const v = vars(id, scheme)
    const n = (k: string): number => parseFloat(v[k])
    const bg = hex(v.bg)
    const bad = COLOURS.flatMap((c) => {
      const [L, C, h] = toLch(hex(c))
      const ink = fromLch(Math.min(n('ev-lmax'), Math.max(n('ev-lmin'), L)), Math.min(C, n('ev-cmax')), h)
      const tint = mix(ink, bg, n('ev-mix') / 100)
      const text = fromLch(n('ev-text-l'), Math.min(C, n('ev-text-cmax'), n('ev-cmax')), h)
      const bar = contrast(ink, bg), title = contrast(text, tint)
      return bar >= 3 && title >= 4.5 ? [] : [`${c} bar ${bar.toFixed(2)} title ${title.toFixed(2)}`]
    })
    expect(bad).toEqual([])
  })
})
