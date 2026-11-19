import { useEffect, useRef, useState } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { boardActions, useBoard } from '../../state/board'
import { store, useStore } from '../../state/store'
import { hasTracing, useTracings } from '../../state/tracings'
import { startNewTracing } from '../card/Tracings'
import { pickScan } from '../scanDrop'
import { TYPING } from '../typing'
import { useBand } from '../view/Band'
import { PopMenu, useDismiss } from '../view/PopMenu'

/**
 * The key that goes round the model, the brief, the scans and a tracing (the last two when the project has one). Heard anywhere outside a field and the terminal, with a project open on
 * its own page (not over the page of projects, nor of a new one).
 */
export function useBoardSwapKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!pressed(e, 'board.swap')) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const s = store.getState()
      if (s.page !== 'object' || s.objectId === null || !s.workspace) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) boardActions.swap({ scans: store.getState().scans.length > 0, tracing: hasTracing() })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

const NAMES = { model: 'Model', brief: 'Brief', scans: 'Scans', tracing: 'Tracing' } as const

/**
 * The switch at the top left of the main area: Model and Brief, and Scans and Tracing when the project has a scan or a tracing (or while
 * that view is the one shown), with the key that goes round them. At its end a `+` makes the first of either: Import scan…, New tracing….
 * It steps aside while a band holds its place (`ui/view/Band.tsx`).
 */
export function BoardSwitch() {
  const shown = useBoard((s) => s.shown)
  const open = useStore((s) => s.page === 'object' && s.objectId !== null)
  const objectId = useStore((s) => s.objectId)
  // A scans file that could not be read, or an import that was refused, has its word in the panel, so the tab is there for it too.
  const hasScans = useStore((s) => s.scans.length > 0 || s.scansProblem !== null || s.scansRefused !== null)
  const importing = useStore((s) => s.importing !== null)
  const hasTracings = useTracings((s) => (s.file?.tracings.length ?? 0) > 0)
  const band = useBand()
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(menu, box, () => setMenu(false))
  if (!open || band !== null) return null
  const views = (['model', 'brief', 'scans', 'tracing'] as const).filter((which) => which === 'model' || which === 'brief' || shown === which || (which === 'scans' ? hasScans : hasTracings))
  return (
    <div className="pboard-switch" role="group" aria-label="Show">
      {views.map((which) => (
        <button key={which} type="button" className="pboard-switch-button" aria-pressed={shown === which} aria-keyshortcuts={hint('board.swap')} onClick={() => boardActions.show(which)}>
          {NAMES[which]}
        </button>
      ))}
      <div className="pboard-add-box" ref={box}>
        <button type="button" className="pboard-switch-button pboard-add" aria-label="Add a scan or a tracing" aria-haspopup="menu" aria-expanded={menu} title="Import a scan, or make a tracing" onClick={() => setMenu((was) => !was)}>
          +
        </button>
        {menu && (
          <PopMenu label="Add" className="pboard-add-menu" close={() => setMenu(false)}>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              aria-disabled={importing ? 'true' : undefined}
              title="Import a scan: GLB, glTF, OBJ, PLY or STL"
              onClick={() => {
                if (importing || objectId === null) return
                setMenu(false)
                pickScan(objectId)
              }}
            >
              Import scan…
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              title="Lay one plane of the model flat, at true size"
              onClick={() => {
                setMenu(false)
                startNewTracing()
              }}
            >
              New tracing…
            </button>
          </PopMenu>
        )}
      </div>
      <kbd className="pboard-switch-key num" title="Goes round the views">
        {hint('board.swap')}
      </kbd>
    </div>
  )
}
