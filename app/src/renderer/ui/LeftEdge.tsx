import { useLayoutEffect, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { which } from '../../shared/keys'
import { clampLeft, CARD_NARROW, leftDefault } from '../state/column'
import { actions, useStore } from '../state/store'
import { giveKeysBack } from './typing'

const KEY_STEP = 16
const drag: { current: { startX: number; startWidth: number; width: number } | null } = { current: null }

/** The width the dock takes from the window right now: nothing while it is away. */
function dockSpace(shell: HTMLElement): number {
  const dock = shell.querySelector<HTMLElement>('.dock')
  return dock && !dock.hidden ? dock.getBoundingClientRect().width : 0
}

/**
 * The right edge of the docked panel (`role="separator"`): dragged, or moved with Left and Right, the panel is
 * wider, up to what leaves the viewport its room beside the session dock, and never narrower than its
 * default (296 px, 264 in a window narrower than 1360 px). A double click puts the default back. While it is dragged the width goes straight to `--card-w` on the
 * shell (the grid's second column, and the view's offset from the left, `--left-w`); the store, and the window's storage
 * with it, has it once the edge is let go. The shell has what is kept as far as the window has room for it now, and
 * what is kept is not touched.
 */
export function LeftEdge({ shell }: { shell: RefObject<HTMLDivElement | null> }) {
  const width = useStore((s) => s.column.width)
  const dockOpen = useStore((s) => s.dockOpen)

  useLayoutEffect(() => {
    const el = shell.current
    if (!el) return
    const fit = (): void => {
      if (drag.current) return
      el.style.setProperty('--card-w', `${clampLeft(width, window.innerWidth, dockSpace(el))}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => {
      window.removeEventListener('resize', fit)
      el.style.removeProperty('--card-w')
    }
  }, [shell, width, dockOpen])

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const startWidth = e.currentTarget.parentElement!.getBoundingClientRect().width
    drag.current = { startX: e.clientX, startWidth, width: startWidth }
    shell.current?.toggleAttribute('data-resizing-left', true)
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || !shell.current) return
    d.width = clampLeft(d.startWidth + e.clientX - d.startX, window.innerWidth, dockSpace(shell.current))
    shell.current.style.setProperty('--card-w', `${d.width}px`)
  }

  function onUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    drag.current = null
    shell.current?.toggleAttribute('data-resizing-left', false)
    // A press that moved nothing (the first of a double click) keeps what there was.
    if (d.width !== d.startWidth) actions.setPanelWidth(d.width)
    giveKeysBack(e.currentTarget)
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const way = which(e, 'left.resize')
    if (way < 0 || !shell.current) return
    e.preventDefault()
    const now = e.currentTarget.parentElement!.getBoundingClientRect().width
    const next = clampLeft(now + (way === 0 ? -KEY_STEP : KEY_STEP), window.innerWidth, dockSpace(shell.current))
    actions.setPanelWidth(next)
  }

  return (
    <div
      className="left-edge"
      role="separator"
      aria-label="Resize panel"
      aria-orientation="vertical"
      aria-valuenow={Math.max(width, leftDefault(window.innerWidth))}
      aria-valuemin={leftDefault(window.innerWidth)}
      tabIndex={0}
      title="Drag to make the panel wider; a double click puts the default back"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
      onDoubleClick={() => actions.setPanelWidth(CARD_NARROW)}
    />
  )
}
