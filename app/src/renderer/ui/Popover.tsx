import { useEffect, useLayoutEffect, useRef, type AriaAttributes, type AriaRole, type ReactNode } from 'react'
import { pressed } from '../../shared/keys'
import { placePopover } from './popoverPlace'

export interface PopoverProps extends Pick<AriaAttributes, 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-modal'> {
  /** The element it stands from, with a stem to it. Null (or one that is gone) takes the element the popover is rendered in. */
  anchor: HTMLElement | null
  /** Which side of the anchor it opens on; the other when there is no room. */
  side?: 'below' | 'above'
  /** In px. */
  width?: number
  /** Escape asks for it. The owner takes it away. */
  onClose: () => void
  role?: AriaRole
  className?: string
  children: ReactNode
}

/**
 * A card that stands from an element, with a stem to it (spec 2026-11-18, section 2, Confirm): `--raise`, radius 10,
 * `--float-shadow`. It is drawn where it is rendered, so that what it asks stays inside the panel it belongs to, and
 * set `position: fixed` from the anchor's box, so that no panel clips it. Escape closes it, and the focus goes back to
 * the anchor when it goes, if it was in the card. Used by `Confirm`, and by whatever else stands from a button.
 */
export function Popover({ anchor, side = 'below', width = 290, onClose, role = 'dialog', className, children, ...aria }: PopoverProps) {
  const card = useRef<HTMLDivElement>(null)
  const latest = useRef({ anchor, side, width })
  latest.current = { anchor, side, width }

  useLayoutEffect(() => {
    const self = card.current!
    const place = (): void => {
      const { anchor: given, side: wanted } = latest.current
      const target = given?.isConnected ? given : self.parentElement
      if (!target) return
      const box = target.getBoundingClientRect()
      const at = placePopover({ x: box.left, y: box.top, w: box.width, h: box.height }, { w: self.offsetWidth, h: self.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, wanted)
      // A panel that is transformed or filtered holds `fixed` children to itself: what it adds is taken off.
      self.style.left = '0px'
      self.style.top = '0px'
      const held = self.getBoundingClientRect()
      self.style.left = `${Math.round(at.x - held.left)}px`
      self.style.top = `${Math.round(at.y - held.top)}px`
      self.style.setProperty('--stem', `${Math.round(at.stem)}px`)
      self.dataset.side = at.side
      self.style.visibility = ''
    }
    place()
    const sized = new ResizeObserver(place)
    sized.observe(self)
    if (anchor) sized.observe(anchor)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      sized.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, side, width])

  // Gone, it gives the focus back to what it stood from, unless the focus had already gone somewhere on purpose.
  useEffect(() => {
    const self = card.current!
    return () => {
      const { anchor: was } = latest.current
      const active = document.activeElement
      const lost = active === null || active === document.body || self.contains(active)
      if (lost && was?.isConnected) was.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div
      ref={card}
      className={className ? `popover ${className}` : 'popover'}
      role={role}
      style={{ width, visibility: 'hidden' }}
      {...aria}
      onKeyDown={(e) => {
        if (!pressed(e, 'sheet.close')) return
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }}
    >
      <span className="popover-stem" aria-hidden="true" />
      {children}
    </div>
  )
}
