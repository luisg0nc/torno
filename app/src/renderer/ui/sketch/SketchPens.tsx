import { hint } from '../../../shared/keys'
import { setPen, useSketching, type SketchPen } from '../../state/sketching'
import { useTool } from '../../state/tools'

const PENS: { pen: SketchPen; label: string; id: 'sketch.free' | 'sketch.line' | 'sketch.points' | 'sketch.erase'; title: string }[] = [
  { pen: 'free', label: 'Free', id: 'sketch.free', title: 'Freehand: press and drag' },
  { pen: 'line', label: 'Line', id: 'sketch.line', title: 'Straight line: press and drag, or click twice' },
  { pen: 'points', label: 'Point to point', id: 'sketch.points', title: 'Point to point: a click for each point, Enter ends it' },
  { pen: 'erase', label: 'Erase', id: 'sketch.erase', title: 'Eraser: a click takes the stroke under the pointer' }
]

/**
 * The pens of a sketch being drawn, a small strip over the view at its foot, beside the triad: the three pens and the eraser (Snap and X-ray
 * are switches in the sketch panel, in the card's head). Each is the button of a key (`sketchTool` hears the same keys) and calls
 * the same actions; the strip is shown while Draw has a sketch open, as the panel is.
 */
export function SketchPens() {
  const inHand = useTool() === 'draw'
  const open = useSketching((s) => s.open !== null)
  const pen = useSketching((s) => s.pen)
  if (!inHand || !open) return null
  return (
    <div className="sketchpens" role="group" aria-label="Pens of the sketch">
      {PENS.map((p) => (
        <button key={p.pen} type="button" className="sketchpens-button" aria-pressed={pen === p.pen} aria-keyshortcuts={hint(p.id)} title={`${p.title} (${hint(p.id)})`} onClick={() => setPen(p.pen)}>
          <span>{p.label}</span>
          <kbd>{hint(p.id)}</kbd>
        </button>
      ))}
    </div>
  )
}
