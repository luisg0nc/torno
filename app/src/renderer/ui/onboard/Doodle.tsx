import type { Stroke } from '../../state/onboard'
import { InkPad } from '../ink/InkPad'
import { BOARD, doodlePng } from '../ink/strokes'

/** The ink as the theme has it now: the board's strokes are drawn in it; the PNG is made in its own. */
const inkNow = (): string => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#22252A'

/**
 * The doodle board of a new object: 1200 x 800 board pixels on the panel's ground with a light grid, in the theme's ink. "Done" gives
 * the strokes back with the PNG made of them, dark on white whatever the theme (`doodlePng`).
 */
export function Doodle({ initial, onDone, onCancel }: { initial: Stroke[]; onDone: (strokes: Stroke[], png: Uint8Array) => void; onCancel: () => void }) {
  return (
    <InkPad
      title="Doodle"
      label="Doodle board"
      hint="Draw what you mean: a shape, where it goes, a size. Hold Shift for a straight line."
      size={BOARD}
      grid
      foot="Claude gets this as a picture, with your note."
      look={() => ({ ink: inkNow() })}
      initial={initial}
      discard={{ label: 'Discard this doodle?', text: 'Discard this doodle? What was drawn since it was opened is not kept.' }}
      onDone={async (strokes) => onDone(strokes, await doodlePng(strokes, true))}
      onCancel={onCancel}
    />
  )
}
