import type { SketchStroke } from '../../../shared/marks'
import type { SketchDraft } from '../../../shared/bridge'
import { planeName } from '../../tools/planes'

/** One row of "Planes and strokes": a plane of the sketch, as the person is told it, and how many strokes are on it. */
export interface PlaneRow {
  id: number
  /** `XZ at y = 40.0`, without the directions of its axes. */
  name: string
  strokes: number
}

/** The planes of a sketch with how many strokes are on each, in the order they were made. */
export function planeRows(draft: Pick<SketchDraft, 'planes' | 'strokes'>): PlaneRow[] {
  return draft.planes.map((plane) => ({ id: plane.id, name: planeName(plane.label), strokes: draft.strokes.filter((s) => s.plane === plane.id).length }))
}

/** How many strokes are on the surface of the parts: those with no plane. */
export function surfaceStrokes(draft: { strokes: readonly Pick<SketchStroke, 'plane'>[] }): number {
  return draft.strokes.filter((s) => s.plane === undefined).length
}

/** One stroke of the sketch in the panel's list, by its id: what a set names it by (`M7/k3`). */
export interface StrokeRow {
  /** The stroke's own id, `k3`. */
  id: string
  /** `M7/k3`. */
  ref: string
  /** Which plane it is on, as the person is told it; `On surfaces` for one with none. */
  where: string
  /** The plane's id, or `surface`: the row it is listed under. */
  plane: number | 'surface'
}

/**
 * The strokes of a sketch by their ids, in the order they were drawn: only those main has numbered, and only of a sketch main has
 * kept (`sketch` is its mark's number). A stroke just drawn has no id until main has it, and joins the list then.
 */
export function strokeRows(draft: Pick<SketchDraft, 'planes' | 'strokes'>, sketch: string | undefined): StrokeRow[] {
  if (sketch === undefined) return []
  return draft.strokes.flatMap((stroke) => {
    if (stroke.id === undefined) return []
    const plane = stroke.plane === undefined ? undefined : draft.planes.find((p) => p.id === stroke.plane)
    return [{ id: stroke.id, ref: `${sketch}/${stroke.id}`, where: plane ? planeName(plane.label) : 'On surfaces', plane: plane ? plane.id : 'surface' }]
  })
}
