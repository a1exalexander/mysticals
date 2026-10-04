type Item = { label: string; disabled?: boolean }

/** The first enabled index walking from `start` in `dir` (±1), inclusive; -1 when there is none. */
function scan(items: Item[], start: number, dir: 1 | -1): number {
  for (let i = start; i >= 0 && i < items.length; i += dir) if (!items[i].disabled) return i
  return -1
}

/** The first (`dir` 1) or last (`dir` -1) enabled index; -1 when none. */
export function edge(items: Item[], dir: 1 | -1): number {
  return scan(items, dir === 1 ? 0 : items.length - 1, dir)
}

/** The next enabled index after `from` in `dir`; stays at `from` at the ends. From -1, the edge in `dir`. */
export function step(items: Item[], from: number, dir: 1 | -1): number {
  if (from < 0) return edge(items, dir)
  const next = scan(items, from + dir, dir)
  return next < 0 ? from : next
}

/** Type-ahead: the next enabled item after `from` whose label starts with `prefix`, wrapping; -1 when none. */
export function typeahead(items: Item[], from: number, prefix: string): number {
  const p = prefix.toLowerCase()
  for (let k = 1; k <= items.length; k++) {
    const i = (((from + k) % items.length) + items.length) % items.length
    if (!items[i].disabled && items[i].label.toLowerCase().startsWith(p)) return i
  }
  return -1
}
