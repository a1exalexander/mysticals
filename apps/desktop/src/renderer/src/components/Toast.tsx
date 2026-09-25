import { useEffect, useRef, useState } from 'react'
import { bus, type BusEvents } from '../bus'

const SHOW_MS = 5000

/** One toast at a time, bottom centre; hovering keeps it up. Rendered once in the app shell. */
export function ToastHost(): React.JSX.Element | null {
  const [toast, setToast] = useState<(BusEvents['toast'] & { id: number }) | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const arm = (): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), SHOW_MS)
  }

  useEffect(() => {
    let n = 0
    const off = bus.on('toast', (t) => {
      setToast({ ...t, id: ++n })
      arm()
    })
    return () => {
      off()
      clearTimeout(timer.current)
    }
  }, [])

  if (!toast) return null
  return (
    <div
      key={toast.id}
      className={`toast${toast.error ? ' is-error' : ''}`}
      role={toast.error ? 'alert' : 'status'}
      data-testid="toast"
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={arm}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            setToast(null)
            toast.action!.run()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
