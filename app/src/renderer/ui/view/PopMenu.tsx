import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import { pressed, which } from '../../../shared/keys'

/**
 * A menu hung from a pill of the compass, from its right edge (the compass stands at the right of the view). The focus goes
 * into it when it opens; the arrows, Home and End move among what can be chosen; Escape and Tab put it away, and the focus
 * goes back to what opened it (`close`).
 */
export function PopMenu({ label, className, close, children }: { label: string; className?: string; close: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null)
  const items = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]

  useEffect(() => {
    items()[0]?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const end = which(e, 'menu.ends')
    if (pressed(e, 'menu.close')) close()
    else if (pressed(e, 'menu.next')) all[(at + 1) % all.length]?.focus()
    else if (pressed(e, 'menu.previous')) all[(at - 1 + all.length) % all.length]?.focus()
    else if (end === 0) all[0]?.focus()
    else if (end === 1) all.at(-1)?.focus()
    else return
    // The menu's own: neither the pane (Escape puts a tool down) nor the compass (the arrows) is meant.
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div ref={menu} className={`menu view-popover${className ? ` ${className}` : ''}`} data-side="right" role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  )
}

/** A press anywhere but in `within` (or Escape) puts away what is open. */
export function useDismiss(open: boolean, within: { current: HTMLElement | null }, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const away = (e: Event): void => {
      if (e instanceof KeyboardEvent ? pressed(e, 'menu.close') : !(e.target instanceof Node && within.current?.contains(e.target))) close()
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', away)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', away)
    }
  }, [open])
}
