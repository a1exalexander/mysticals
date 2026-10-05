import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../theme'
import { THEMES as LANDING, TOKENS } from '../../../../../landing/src/themes'

// The landing page's theme demos copy the palettes from base.css; keep them from drifting apart.
const css = readFileSync(join(__dirname, 'base.css'), 'utf8')
const palette = (id: string): Record<string, string> => {
  const block = css.match(new RegExp(`:root\\[data-theme='${id}'\\] \\{([^}]*)\\}`))?.[1] ?? ''
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]))
}

describe('landing themes', () => {
  it('lists the same themes, in order', () => {
    expect(LANDING.map(({ id, name, scheme }) => ({ id, name, scheme }))).toEqual(
      THEMES.map(({ id, name, scheme }) => ({ id, name, scheme }))
    )
  })
  it.each(THEMES.map((th) => th.id))('%s matches base.css', (id) => {
    const p = palette(id)
    expect(Object.keys(p).sort()).toEqual([...TOKENS].sort())
    expect(LANDING.find((th) => th.id === id)?.tokens).toEqual(p)
  })
})
