import { type Anchor, type Mark, type NewMark, type SketchPlane, type Vec3, markPoints } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { type TracingPlane, type TracingsFile, TRACING_ID, inPlane, onTracingWords, toUv } from '../../shared/tracings'

export { onTracingWords }
import { type AskedAnchor, type NearestAnchor, answered, judgePin } from '../marks/reanchor'
import { tolerance } from '../marks/tolerance'
import { Refusal } from '../refusal'

// What main says of a mark made on a tracing (`Mark.tracing`): that the tracing is there, is of the mark's layout, and that every point
// the mark holds lies in its plane. The check is made when the mark is placed and after each move (`MarkStore.followTracing`, which
// asks it of the plane the mark is moved into); main works out the mark's `uv` itself and ties a pin on the outline to the face under it.

/** How far from the plane a point of a mark may lie, in mm: the frame's own noise and no more. */
export const PLANE_WITHIN = 1e-6

/** The plane a tracing's own frame is, as a sketch plane is compared with it. */
const sameFrame = (plane: SketchPlane, of: TracingPlane): boolean =>
  [0, 1, 2].every((i) => Math.abs(plane.origin[i] - of.origin[i]) <= PLANE_WITHIN && Math.abs(plane.x[i] - of.x[i]) <= PLANE_WITHIN && Math.abs(plane.y[i] - of.y[i]) <= PLANE_WITHIN)

/**
 * Why a mark that names a tracing is not on it, or null: the tracing exists, is of the mark's layout, and every point the mark
 * holds (`markPoints`) lies in its plane within 1e-6 mm. A sketch (ink) has the tracing's plane as each of its planes, made `from`
 * that tracing, with the tracing's own frame. A mark that names none is no business of the tracings.
 */
export function checkOnTracing(mark: Mark | NewMark, tracings: TracingsFile): Refusal | null {
  const id = (mark as { tracing?: unknown }).tracing
  if (id === undefined) return null
  const ids = tracings.tracings.map((t) => t.id).join(', ') || 'none'
  if (typeof id !== 'string' || !TRACING_ID.test(id)) return new Refusal(`${String(id)} is no tracing id; tracings: ${ids}`)
  const t = tracings.tracings.find((one) => one.id === id)
  if (!t) return new Refusal(`no tracing ${id}; tracings: ${ids}`)
  if (t.layout !== mark.layout) return new Refusal(`${id} is a tracing of the layout ${t.layout}, not ${String(mark.layout)}`)
  if (mark.kind === 'sketch') {
    for (const plane of mark.planes) {
      if (plane.from.kind !== 'tracing' || plane.from.tracing !== id || !sameFrame(plane, t.plane)) return new Refusal(`plane ${plane.id} of the sketch is not the plane of ${id}: ink on a tracing is drawn in its plane`)
    }
  }
  const points = markPoints(mark as Mark)
  const off = points.map((p) => (inPlane(t.plane, p, PLANE_WITHIN) ? 0 : 1)).indexOf(1)
  if (off >= 0) return new Refusal(`point ${off + 1} of the mark is not in the plane of ${id} (within ${PLANE_WITHIN} mm): a mark on a tracing lies in it`)
  return null
}

/**
 * The mark with `uv`: the `[u, v]` in mm of each point it holds (`markPoints`), worked out here from the tracing's frame and never
 * taken from the window. A mark on no tracing, one whose tracing is not there, and a sketch (whose strokes are in `points2d`, the
 * plane's own uv) are returned as they are.
 */
export function withUv<M extends NewMark>(mark: M, tracings: TracingsFile): M {
  const id = (mark as { tracing?: unknown }).tracing
  if (id === undefined || mark.kind === 'sketch') return mark
  const t = tracings.tracings.find((one) => one.id === id)
  if (!t) return mark
  const points = markPoints(mark as unknown as Mark)
  if (points.length === 0) return mark
  return { ...mark, uv: points.map((p) => toUv(t.plane, p)) }
}

/** The kernel's `nearest` of the last build, as the marks' checks ask it. */
export type NearestAsk = (layout: string, anchors: AskedAnchor[]) => Promise<NearestAnchor[]>

/**
 * Where a pin placed on a tracing is tied to the model: on the outline, within the part's tolerance of a face (or on an edge), it
 * is tied to that part, with the face's ref, normal and descriptor as any pin is (`judgePin`); anywhere else, or when the kernel
 * cannot say, it is a point in empty space, and the anchor holds only the point. The point stays where the person put it.
 */
export async function tiePin(nearest: NearestAsk, scene: Scene, layout: string, point: Vec3): Promise<Anchor> {
  const parts = scene.parts.filter((p) => p.layout === layout)
  if (parts.length === 0) return { point }
  let found: NearestAnchor[]
  try {
    found = await nearest(layout, parts.map((p) => ({ part: p.name, point })))
  } catch {
    return { point }
  }
  let best: Anchor | undefined
  let least = Infinity
  found.forEach((one, i) => {
    if (!answered(one) || one.distance >= least || !parts[i]) return
    const judged = judgePin({ point, part: one.part }, one, tolerance(parts[i].bbox))
    if (judged.state !== 'ok') return
    least = one.distance
    best = judged.anchor
  })
  return best ?? { point }
}

export interface PlaceDeps {
  /** The tracings of the project, as they are now. */
  tracings: { list(objectId: string): Promise<TracingsFile> }
  /** The kernel's `nearest` of the project's last build. */
  nearest(objectId: string, layout: string, anchors: AskedAnchor[]): Promise<NearestAnchor[]>
  /** The last successful build of the project: the scene its parts are in. None before the first. */
  scene(objectId: string): { scene: Scene } | undefined
}

/**
 * A mark of the person's that names a tracing, as main keeps it (`marks:add`): a pin with no part is tied to the face under it when
 * it is on the outline (`tiePin`), and the mark is judged by what `placed` says of where it stands (`asPlaced`: the spread, the
 * tag) before it is checked (`checkOnTracing`): a Refusal, in words, when it is not in the plane of a tracing that is there.
 * Its `uv` are main's own (`withUv`). A mark that names no tracing is handed back as it came.
 */
export async function placeOnTracing<M extends NewMark>(deps: PlaceDeps, objectId: string, mark: M, placed: (mark: M) => M = (m) => m): Promise<M> {
  if ((mark as { tracing?: unknown }).tracing === undefined) return placed(mark)
  const file = await deps.tracings.list(objectId)
  let tied = mark
  if (mark.kind === 'pin' && mark.anchor?.part === undefined && Array.isArray(mark.anchor?.point)) {
    const last = deps.scene(objectId)
    if (last) tied = { ...mark, anchor: await tiePin((layout, anchors) => deps.nearest(objectId, layout, anchors), last.scene, mark.layout, mark.anchor.point) }
  }
  const made = placed(tied)
  const refusal = checkOnTracing(made, file)
  if (refusal) throw refusal
  return withUv(made, file)
}
