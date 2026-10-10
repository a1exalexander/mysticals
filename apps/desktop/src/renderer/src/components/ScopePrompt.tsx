import { useEffect, useRef, useState } from 'react'
import { bus, type BusEvents } from '../bus'
import { RecurringScope } from './ui/RecurringScope'
import { useModal } from './ui/usePopover'
import './ui/ui.css'

/** Asks which part of a recurring series a change is for (e.g. after dragging an instance). Rendered once in the app shell. */
export function ScopePromptHost(): React.JSX.Element | null {
  const [ask, setAsk] = useState<BusEvents['scope:ask'] | null>(null)
  const shown = useRef<BusEvents['scope:ask'] | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  shown.current = ask

  // A newer question cancels the one still shown.
  useEffect(() => bus.on('scope:ask', (a) => {
    shown.current?.onCancel()
    shown.current = a
    setAsk(a)
  }), [])

  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Esc in a dialog stacked on top (Reauth opens by itself) is that dialog's.
      const d = (e.target as Element).closest?.('dialog')
      if (d && d !== dialog.current) return
      e.stopPropagation()
      e.preventDefault() // not the dialog's own cancel too
      setAsk(null)
      ask.onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ask])

  // Modal: focus lands on the first choice and stays inside.
  useModal(dialog, !!ask)

  if (!ask) return null
  const cancel = (): void => {
    setAsk(null)
    ask.onCancel()
  }
  return (
    <dialog
      ref={dialog}
      className="mc-overlay"
      aria-label={ask.title}
      onCancel={(e) => e.preventDefault()}
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
    >
      <div className="mc-sheet scope-prompt" data-testid="scope-prompt">
        <RecurringScope
          title={ask.title}
          danger={ask.danger}
          onPick={(scope) => {
            setAsk(null)
            ask.onPick(scope)
          }}
          onCancel={cancel}
        />
      </div>
    </dialog>
  )
}
