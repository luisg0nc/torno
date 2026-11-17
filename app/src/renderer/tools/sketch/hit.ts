import { type NewStroke, type SketchMark, type Vec3, sketchStrokePoints } from '../../../shared/marks'

/** How near the pointer must be to a stroke to be on it, in pixels. */
export const STROKE_REACH_PX = 8

/**
 * The stroke of a sketch the pointer is on: the one whose line runs nearest to it on screen, within `STROKE_REACH_PX`, and the
 * later of two as near; its number among the strokes, or null. `project` is where a point of the object frame falls on screen.
 */
export function strokeAt(sketch: Pick<SketchMark, 'planes'> & { strokes: readonly NewStroke[] }, project: (p: Vec3) => [number, number], pointer: [number, number], reach = STROKE_REACH_PX): number | null {
  let best: { index: number; d: number } | null = null
  sketch.strokes.forEach((stroke, index) => {
    const points = sketchStrokePoints(sketch, stroke).map(project)
    if (points.length === 0) return
    let d = Infinity
    if (points.length === 1) d = Math.hypot(points[0][0] - pointer[0], points[0][1] - pointer[1])
    for (let i = 1; i < points.length; i++) d = Math.min(d, toSegment(points[i - 1], points[i], pointer))
    if (d <= reach && (!best || d <= best.d)) best = { index, d }
  })
  return best === null ? null : (best as { index: number }).index
}

function toSegment([ax, ay]: [number, number], [bx, by]: [number, number], [px, py]: [number, number]): number {
  const dx = bx - ax
  const dy = by - ay
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2))
  return Math.hypot(ax + dx * t - px, ay + dy * t - py)
}
