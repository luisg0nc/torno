import { hint } from '../../../shared/keys'
import type { KeyId } from '../../../shared/keys'
import { type BoardTool, useBoard } from '../../state/board'

/** The tools of the board, in the order of the sheet of keys: each is a row of `shared/keys.ts`. */
export const BOARD_TOOLS: ReadonlyArray<{ tool: BoardTool; label: string; id: KeyId; does: string }> = [
  { tool: 'select', label: 'Select', id: 'board.select', does: 'Click a card, drag on empty space for a box; Shift adds' },
  { tool: 'text', label: 'Text', id: 'board.text', does: 'Click the board and write a card' },
  { tool: 'frame', label: 'Frame', id: 'board.frame', does: 'Drag a box and name it: the cards inside join it' },
  { tool: 'arrow', label: 'Arrow', id: 'board.arrow', does: 'Drag from one card to another' },
  { tool: 'size', label: 'Size', id: 'board.size', does: 'Click the board and give a size you know' },
  { tool: 'picture', label: 'Picture', id: 'board.picture', does: 'Add a photo from a file, or drop one on the board' },
  { tool: 'sketch', label: 'Doodle', id: 'board.sketch', does: 'Draw a card' }
]

/**
 * The palette of the board, at its foot: Select, Text, Frame, Arrow and Size stay in hand until another is chosen; Picture and
 * Doodle do their one thing and Select is in hand again.
 */
export function Palette({ onChoose }: { onChoose: (tool: BoardTool) => void }) {
  const tool = useBoard((s) => s.tool)
  return (
    <div className="pboard-palette" role="toolbar" aria-label="Board tools">
      {BOARD_TOOLS.map((t) => (
        <button key={t.tool} type="button" className="pboard-tool" data-tool={t.tool} aria-pressed={tool === t.tool} title={`${t.does} (${hint(t.id)})`} onClick={() => onChoose(t.tool)}>
          {t.label}
          <span className="pboard-tool-key num">{hint(t.id)}</span>
        </button>
      ))}
    </div>
  )
}
