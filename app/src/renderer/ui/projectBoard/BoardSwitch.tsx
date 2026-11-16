import { useEffect } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { boardActions, useBoard } from '../../state/board'
import { store, useStore } from '../../state/store'
import { TYPING } from '../typing'

/**
 * The key that swaps the board and the model. Heard anywhere outside a field and the terminal, with a project open on
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
      if (!e.repeat) boardActions.toggle()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** The switch at the top left of the main area: Board or Model, with the key that swaps them. */
export function BoardSwitch() {
  const shown = useBoard((s) => s.shown)
  const open = useStore((s) => s.page === 'object' && s.objectId !== null)
  if (!open) return null
  return (
    <div className="pboard-switch" role="group" aria-label="Show">
      {(['board', 'model'] as const).map((which) => (
        <button key={which} type="button" className="pboard-switch-button" aria-pressed={shown === which} aria-keyshortcuts={hint('board.swap')} onClick={() => boardActions.show(which)}>
          {which === 'board' ? 'Board' : 'Model'}
        </button>
      ))}
      <kbd className="pboard-switch-key num" title="Swaps the two">
        {hint('board.swap')}
      </kbd>
    </div>
  )
}
