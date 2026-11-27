import { useEffect, useRef } from 'react'
import { pressed } from '../../../shared/keys'
import { inMenu } from '../inMenu'

/**
 * A picture of the board opened large, over the board: Esc, the button or a click outside it puts it away. Esc is its
 * own while it is up (the board under it does not hear it), but for a menu that has the focus, and the focus goes back to
 * what had it.
 */
export function PictureView({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const sheet = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (!pressed(e, 'sheet.close') || inMenu(e)) return
      e.preventDefault()
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])
  return (
    <section ref={sheet} className="pboard-view" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <img src={url} alt={label} draggable={false} />
      <button type="button" className="button pboard-view-close" onClick={onClose}>
        Close
      </button>
    </section>
  )
}
