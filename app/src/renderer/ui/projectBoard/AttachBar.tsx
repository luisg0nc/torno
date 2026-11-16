import { hint } from '../../../shared/keys'
import { boardActions, useBoard } from '../../state/board'
import { actions } from '../../state/store'

/** Where the next prompt is written: the dock is opened for it. */
function toPrompt(): void {
  actions.setDockOpen(true)
}

/**
 * What of the board goes with the next prompt, at the top of the board: the cards and frames selected, or all of it. It
 * waits as a chip above the composer of the chat until the prompt is sent.
 */
export function AttachBar() {
  const board = useBoard((s) => s.board)
  const selected = useBoard((s) => s.selected)
  const attached = useBoard((s) => s.attached)
  const chosen = board ? selected.filter((id) => board.cards.some((c) => c.id === id && !c.hidden)).length : 0
  const any = board?.cards.some((c) => !c.hidden) === true
  return (
    <div className="pboard-attach" role="toolbar" aria-label="Send to Claude">
      <button
        type="button"
        className="pboard-attach-button"
        data-attach="selected"
        disabled={chosen === 0}
        title={`Put the ${chosen === 1 ? 'card' : 'cards and frames'} selected in the chat, to go with your next prompt (${hint('board.attach')})`}
        onClick={() => {
          if (boardActions.attachSelected()) toPrompt()
        }}
      >
        Send with the next prompt
      </button>
      <button
        type="button"
        className="pboard-attach-button"
        data-attach="all"
        aria-pressed={attached?.ids === 'all'}
        disabled={!any}
        title="Put every card of the board in the chat, to go with your next prompt"
        onClick={() => {
          boardActions.attachAll()
          toPrompt()
        }}
      >
        Send the whole board
      </button>
    </div>
  )
}
