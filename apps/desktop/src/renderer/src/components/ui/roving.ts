/**
 * Index a key moves the selection to among `n` options, wrapping: Right (and Down when `vertical`) the next, Left (and
 * Up) the previous, Home / End the first / last; -1 for any other key.
 */
export function rovingIndex(key: string, i: number, n: number, vertical: boolean): number {
  if (key === 'ArrowRight' || (vertical && key === 'ArrowDown')) return (i + 1) % n
  if (key === 'ArrowLeft' || (vertical && key === 'ArrowUp')) return (i - 1 + n) % n
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return -1
}

/**
 * WAI-ARIA radio group over role="radio" buttons: one Tab stop (the checked option, else the first) and the arrow
 * keys select and focus the previous / next option, like native radios.
 */
export function radioGroup<T>(
  options: readonly T[],
  value: T,
  onChange: (v: T) => void
): { onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void; tabIndex: (o: T) => number } {
  const i = Math.max(0, options.indexOf(value))
  return {
    onKeyDown: (e) => {
      const next = rovingIndex(e.key, i, options.length, true)
      if (next < 0) return
      e.preventDefault()
      onChange(options[next])
      e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
    },
    tabIndex: (o) => (o === options[i] ? 0 : -1)
  }
}
