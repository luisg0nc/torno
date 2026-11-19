import { useEffect } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { boardActions, useBoard } from '../../state/board'
import { store, useStore } from '../../state/store'
import { hasTracing } from '../../state/tracings'
import { TYPING } from '../typing'
import { useBand } from '../view/Band'

/**
 * The key that goes round the model, the brief and a tracing. Heard anywhere outside a field and the terminal, with a project open on
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
      if (!e.repeat) boardActions.swap(hasTracing())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** The switch at the top left of the main area: Model, Brief or Tracing, with the key that goes round them. It steps aside while a band holds its place (`ui/view/Band.tsx`). */
export function BoardSwitch() {
  const shown = useBoard((s) => s.shown)
  const open = useStore((s) => s.page === 'object' && s.objectId !== null)
  const band = useBand()
  if (!open || band !== null) return null
  return (
    <div className="pboard-switch" role="group" aria-label="Show">
      {(['model', 'brief', 'tracing'] as const).map((which) => (
        <button key={which} type="button" className="pboard-switch-button" aria-pressed={shown === which} aria-keyshortcuts={hint('board.swap')} onClick={() => boardActions.show(which)}>
          {which === 'brief' ? 'Brief' : which === 'model' ? 'Model' : 'Tracing'}
        </button>
      ))}
      <kbd className="pboard-switch-key num" title="Goes round the three">
        {hint('board.swap')}
      </kbd>
    </div>
  )
}
