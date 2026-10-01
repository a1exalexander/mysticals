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
