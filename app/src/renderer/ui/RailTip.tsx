import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The name of a rail button, shown beside it as an ink pill: at once, with the pointer over the button and with the
 * keyboard's focus on it (`:focus-visible`, so a press with the pointer is no cause) and put away when either goes. It is
 * a picture of the name and no more: the button has its own accessible name, so the tip is `aria-hidden`. It is placed
 * from the button's box, 6 px to its right, and drawn over the window (a portal, fixed), so no column clips it. It has no
 * transition: it is there or it is not.
 */
export function RailTip({ label, for: target }: { label: string; for: HTMLElement | null }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (target === null) return
    const show = (): void => {
      const box = target.getBoundingClientRect()
      setAt({ left: box.right + 6, top: box.top + box.height / 2 })
    }
    const hide = (): void => setAt(null)
    const onFocus = (): void => {
      if (target.matches(':focus-visible')) show()
    }
    target.addEventListener('pointerenter', show)
    target.addEventListener('pointerleave', hide)
    target.addEventListener('focus', onFocus)
    target.addEventListener('blur', hide)
    return () => {
      target.removeEventListener('pointerenter', show)
      target.removeEventListener('pointerleave', hide)
      target.removeEventListener('focus', onFocus)
      target.removeEventListener('blur', hide)
      setAt(null)
    }
  }, [target])
  if (target === null || at === null) return null
  return createPortal(
    <span className="rail-tip" aria-hidden="true" style={{ left: at.left, top: at.top }}>
      {label}
    </span>,
    document.body
  )
}
