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
