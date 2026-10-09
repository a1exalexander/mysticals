import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// A coloured side border (or inset-shadow bar) on a rounded box bends into a "crescent": banned, see CLAUDE.md.
// ponytail: checks one rule at a time; a radius set in another rule for the same element slips through.
const root = join(__dirname, '..')
const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? cssFiles(join(dir, d.name)) : d.name.endsWith('.css') ? [join(dir, d.name)] : []
  )

const SIDE_BAR = /border-(left|right|top|bottom)\s*:\s*([2-9]|\d{2,})(\.\d+)?px\s+(solid|dashed)|box-shadow\s*:[^;]*inset\s+-?[1-9]\d*px\s+0/
const rounded = (rule: string): boolean =>
  [...rule.matchAll(/border-radius\s*:\s*([^;]+)/g)].some(([, v]) => v.trim().split(/\s+/).some((x) => parseFloat(x) !== 0))

export const crescents = (css: string): string[] =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter((rule) => SIDE_BAR.test(rule) && rounded(rule))
    .map((rule) => rule.split('{')[0].trim())

describe('no crescent borders', () => {
  it('flags a coloured side border on a rounded box', () => {
    expect(crescents('.a { border-radius: 4px; border-left: 2px solid red; }')).toEqual(['.a'])
    expect(crescents('.b { border-radius: 3px; box-shadow: inset 2px 0 var(--c); }')).toEqual(['.b'])
    expect(crescents('.c { border-radius: 0; border-left: 2px solid red; }')).toEqual([])
    expect(crescents('.d { border-radius: 4px; border-left: 1px solid var(--line); }')).toEqual([])
  })

  it('none in the renderer styles', () => {
    const found = cssFiles(root).flatMap((f) => crescents(readFileSync(f, 'utf8')).map((sel) => `${f.slice(root.length + 1)}: ${sel}`))
    expect(found).toEqual([])
  })
})

// Corner radii come from the tokens in base.css (--r-sm controls, --r-md cards/popovers/menus/toast, --r-lg sheets);
// raw px only for square-ish details (dots, tags, badges: 1-3px), 50% for round things. Pills keep their half-height.
const PILLS: Record<string, string> = { '::-webkit-scrollbar-thumb': '5px', '.mc-switch': '8px' }
const RADIUS_OK = /^(0|[123]px|50%|var\(--r-(sm|md|lg)\))$/

export const radiusDrift = (css: string): string[] =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .flatMap((rule) => {
      const [sel, body = ''] = rule.split('{').slice(-2).map((x) => x.trim())
      return [...body.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;]+)/g)]
        .flatMap(([, v]) => v.trim().split(/\s+/))
        .filter((x) => !RADIUS_OK.test(x) && PILLS[sel] !== x)
        .map((x) => `${sel}: ${x}`)
    })

describe('no drifting border radii', () => {
  it('flags a raw radius outside the tokens', () => {
    expect(radiusDrift('.a { border-radius: 5px; } .b { border-radius: 10px; }')).toEqual(['.a: 5px', '.b: 10px'])
    expect(radiusDrift('@media (x) { .c { border-radius: 6px; } }')).toEqual(['.c: 6px'])
    expect(radiusDrift('.h { border-top-left-radius: 5px; border-end-end-radius: var(--r-sm); }')).toEqual(['.h: 5px'])
    expect(radiusDrift('.d { border-radius: var(--r-sm) 0 0 var(--r-sm); } .e { border-radius: 50%; } .f { border-radius: 3px; }')).toEqual([])
    expect(radiusDrift('.mc-switch { border-radius: 8px; } .g { border-radius: 8px; }')).toEqual(['.g: 8px'])
  })

  it('none in the renderer styles', () => {
    const found = cssFiles(root).flatMap((f) => radiusDrift(readFileSync(f, 'utf8')).map((d) => `${f.slice(root.length + 1)}: ${d}`))
    expect(found).toEqual([])
  })
})
