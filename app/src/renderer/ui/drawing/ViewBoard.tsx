import { drawingActions, useDrawing } from '../../state/drawing'
import { InkPad } from '../ink/InkPad'
import { finishDrawing } from './make'

/**
 * The board over a picture of the view (the chat's "Draw on view"), while one is open: the agent's own picture of the
 * view under the ink, which is a colour of its own over a casing. Over the whole window, as the export sheet is.
 */
export function ViewBoard() {
  const board = useDrawing((s) => s.board)
  if (!board) return null
  const { picture } = board
  return (
    <InkPad
      title="Draw on view"
      label="Drawing on the view"
      hint="Ring it, point at it, sketch beside it. Claude gets this picture with your ink, and what the ink lies over."
      size={{ width: picture.width, height: picture.height }}
      ground={picture.url}
      look={() => ({ ink: picture.ink, casing: picture.casing })}
      initial={board.strokes}
      discard={{ label: 'Discard this drawing?', text: 'Discard this drawing? What was drawn since it was opened is not kept.' }}
      onDone={finishDrawing}
      onCancel={() => drawingActions.cancel()}
    />
  )
}
