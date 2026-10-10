import { useState } from 'react'

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
 * WAI-ARIA radio group over role="radio" buttons: one Tab stop and the arrow keys select and focus the previous / next
 * option, like native radios. Spread `props` on the group. The arrows step from the focused option and it stays the
 * Tab stop while focus is in the group, so they keep going before an async onChange (account colours save over IPC)
 * has updated the value, or after it failed; otherwise the Tab stop is the checked option, else the first.
 */
export function useRadioGroup<T>(
  options: readonly T[],
  value: T,
  onChange: (v: T) => void
): {
  props: Pick<React.HTMLAttributes<HTMLElement>, 'onKeyDown' | 'onFocus' | 'onBlur'>
  tabIndex: (o: T) => number
} {
  const [focused, setFocused] = useState<number>()
  const stop = focused ?? Math.max(0, options.indexOf(value))
  const radios = (group: HTMLElement): HTMLElement[] => [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
  return {
    props: {
      onKeyDown: (e) => {
        const all = radios(e.currentTarget)
        const at = all.indexOf(document.activeElement as HTMLElement)
        const next = rovingIndex(e.key, at < 0 ? stop : at, all.length, true)
        if (next < 0) return
        e.preventDefault()
        onChange(options[next])
        all[next]?.focus()
      },
      onFocus: (e) => {
        const at = radios(e.currentTarget).indexOf(e.target as HTMLElement)
        setFocused(at < 0 ? undefined : at)
      },
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(undefined)
      }
    },
    tabIndex: (o) => (options.indexOf(o) === stop ? 0 : -1)
  }
}
