import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { pressed, which } from '../../shared/keys'

/**
 * The behaviour of a menu that hangs from a button (the folder menu, the project menu): shown or not, put away by a press
 * outside it, the focus into its first item when it comes up and back to the button when it goes by a key. Arrows, Home and
 * End move among the items (`role="menuitem"`, not disabled); Escape and Tab put it away.
 */
export function useMenu(dep: unknown = 0, shownAtFirst = false): {
  shown: boolean
  setShown: (shown: boolean) => void
  button: RefObject<HTMLButtonElement | null>
  menu: RefObject<HTMLDivElement | null>
  close: () => void
  onKeyDown: (e: ReactKeyboardEvent) => void
} {
  const [shown, setShown] = useState(shownAtFirst)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const items = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]

  useEffect(() => {
    if (!shown) return
    const away = (e: PointerEvent): void => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setShown(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [shown])

  // Into the menu once it is there: the first thing that can be chosen.
  useEffect(() => {
    if (shown) items()[0]?.focus({ preventScroll: true })
  }, [shown, dep])

  const close = (): void => {
    setShown(false)
    button.current?.focus()
  }
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
    e.preventDefault()
    e.stopPropagation()
  }
  return { shown, setShown, button, menu, close, onKeyDown }
}
