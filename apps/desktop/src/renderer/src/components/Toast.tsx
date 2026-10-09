import { useEffect, useRef, useState } from 'react'
import { bus, type BusEvents } from '../bus'
import { t, useLocale } from '../i18n'

const SHOW_MS = 5000

/**
 * One toast at a time, bottom centre; hover or focus inside keeps it up (so Undo can be reached with Tab),
 * an error stays until closed. Rendered once in the app shell.
 */
export function ToastHost(): React.JSX.Element | null {
  const [toast, setToast] = useState<(BusEvents['toast'] & { id: number }) | null>(null)
  const el = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useLocale()
  // Still hovered or focused when it runs out: leaving or blurring arms it again.
  const arm = (): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!el.current?.matches(':hover, :focus-within')) setToast(null)
    }, SHOW_MS)
  }

  useEffect(() => {
    let n = 0
    const off = bus.on('toast', (next) => {
      clearTimeout(timer.current)
      setToast({ ...next, id: ++n })
      if (!next.error) arm()
    })
    return () => {
      off()
      clearTimeout(timer.current)
    }
  }, [])

  if (!toast) return null
  const rearm = toast.error ? undefined : arm
  return (
    <div
      ref={el}
      key={toast.id}
      className={`toast${toast.error ? ' is-error' : ''}`}
      role={toast.error ? 'alert' : 'status'}
      data-testid="toast"
      onMouseLeave={rearm}
      onBlur={rearm}
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
      <button type="button" className="toast-close" aria-label={t('common.close')} onClick={() => setToast(null)}>
        ×
      </button>
    </div>
  )
}
