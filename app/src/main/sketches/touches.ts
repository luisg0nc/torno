import { type NewStroke, type SketchMark, type Vec3, sketchStrokePoints } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { type AskedAnchor, answered, nearestReply } from '../marks/reanchor'
import { tolerance } from '../marks/tolerance'

// What each new stroke of a sketch touches: the faces it lies on or crosses, worked out by main once, when the stroke is
// written, against the build the stroke is of. Never taken from the window. One `nearest` query of the kernel, as the
// check of a mark against a build asks one (`reanchorAll`), on up to eight points along each stroke.

/** The most points of a stroke that are asked about. */
export const TOUCH_SAMPLES = 8

/** What the kernel is asked through: the object, the build's scene (for the parts and their boxes) and `Builds.query`. */
export interface TouchKernel {
  objectId: string
  scene: Scene
  query<T = unknown>(objectId: string, name: string, args: object): Promise<T>
}

/** At most `most` points of `points`, evenly along the list, the first and the last among them. */
function along(points: Vec3[], most: number): Vec3[] {
  if (points.length <= most) return points
  return Array.from({ length: most }, (_, i) => points[Math.round((i * (points.length - 1)) / (most - 1))])
}

/**
 * For each stroke, the faces (`block/F12`) within the part's tolerance of a point along it, in the order they were met and
 * each once. A point is asked of the parts of the layout whose box it is within the tolerance of: it can be on no other.
 * A point the kernel could say nothing of touches nothing known. Rejects when the kernel does, for the caller to decide
 * whether the sketch is kept without (main keeps it, with none).
 */
export async function strokeTouches(kernel: TouchKernel, layout: string, mark: Pick<SketchMark, 'planes'>, strokes: readonly NewStroke[]): Promise<string[][]> {
  const parts = kernel.scene.parts.filter((part) => part.layout === layout)
  const asked: AskedAnchor[] = []
  const of: Array<{ stroke: number; reach: number }> = []
  strokes.forEach((stroke, k) => {
    for (const point of along(sketchStrokePoints(mark, stroke), TOUCH_SAMPLES)) {
      for (const part of parts) {
        const reach = tolerance(part.bbox)
        if (point.every((c, i) => c >= part.bbox.min[i] - reach && c <= part.bbox.max[i] + reach)) {
          asked.push({ part: part.name, point })
          of.push({ stroke: k, reach })
        }
      }
    }
  })
  const touches: string[][] = strokes.map(() => [])
  if (asked.length === 0) return touches
  const found = nearestReply(await kernel.query(kernel.objectId, 'nearest', { layout, anchors: asked }), asked)
  found.forEach((one, i) => {
    if (!answered(one) || one.distance > of[i].reach) return
    const list = touches[of[i].stroke]
    if (!list.includes(one.ref)) list.push(one.ref)
  })
  return touches
}
