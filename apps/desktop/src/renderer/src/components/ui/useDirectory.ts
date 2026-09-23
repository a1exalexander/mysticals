import { useEffect, useState } from 'react'
import type { Account, Calendar } from '@shared/types'

/** Accounts + calendars, reloaded whenever any account's data changes. */
export function useDirectory(active = true): { accounts: Account[]; calendars: Calendar[]; loaded: boolean } {
  const [state, setState] = useState({ accounts: [] as Account[], calendars: [] as Calendar[], loaded: false })
  useEffect(() => {
    if (!active) return
    let live = true
    const load = (): void => {
      Promise.all([window.api.accounts.list(), window.api.calendars.list()])
        .then(([accounts, calendars]) => live && setState({ accounts, calendars, loaded: true }))
        .catch(console.error)
    }
    load()
    const off = window.api.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [active])
  return state
}
