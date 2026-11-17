import { isDeepStrictEqual } from 'node:util'
import { rotate } from '../../shared/align'
import type { SketchDraft } from '../../shared/bridge'
import { type SketchMark, type SketchPlane, type SketchSnap, type NewStroke, type SketchStroke, type Vec3, MAX_NOTE } from '../../shared/marks'
import { type Part, type Scene, bufView } from '../../shared/scene'
import { TRACING_ID } from '../../shared/tracings'
import { type SnapData, EDGE_CIRCLE, EDGE_LINE, circleOf, nearestOnCircle, nearestOnSegment, orthogonal, segmentParameter, vertexAt } from '../../shared/snapdata'
import { anchorOf, cameraOf } from '../marks/file'
import { tolerance } from '../marks/tolerance'
import { Refusal } from '../refusal'
import { readSketch } from './read'

// What main checks of a sketch the window sends (`marks:sketch`), against the last build: its numbers, its planes and its
// caps, and its snaps. A snapped point is the kernel's: main works it out again from the build's snap data, refuses the
// stroke if the window's is more than 0.01 mm from it, and keeps main's own. Only strokes that are new or changed in this
// edit are checked, for a stroke of an earlier build was checked against that build when it was written, and the build is
// gone: the strokes the sketch has are kept as they are, what main worked out of them (`touches`) with them.

/** How far a snapped point may be from the kernel's, in millimetres. */
export const SNAP_MM = 0.01
/** How far the points of a stroke the window sends again may be from those main kept, and still be the same stroke: a point that snapped was set by main, to within `SNAP_MM`. */
const SAME_MM = 0.011
/** How far a vertex may be from the end of the polyline of the edge that ends there, and be taken for it. */
const VERTEX_MATCH_MM = 1e-3

/** The last build of an object, as the checks of a sketch need it: its number, its scene, the blob its buffers are in, and the snap data of a part of the layout. */
export interface SketchBuild {
  revision: number
  scene: Scene
  blob: ArrayBuffer
  snap(part: string): SnapData | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
/** A number as a sentence says it: at most three decimals. */
const mm = (n: number): string => String(Number(n.toFixed(3)))

const planeById = (planes: readonly SketchPlane[], id: number | undefined): SketchPlane | undefined => (id === undefined ? undefined : planes.find((p) => p.id === id))
/** The point of a stroke in the object frame. */
function pointOf(stroke: NewStroke, plane: SketchPlane | undefined, i: number): Vec3 {
  if (stroke.points) return stroke.points[i]
  const [u, v] = (stroke.points2d as [number, number][])[i]
  const p = plane as SketchPlane
  return [p.origin[0] + p.x[0] * u + p.y[0] * v, p.origin[1] + p.x[1] * u + p.y[1] * v, p.origin[2] + p.x[2] * u + p.y[2] * v]
}
/** The point set on the plane of the stroke, by its coordinates. */
const onPlane = (plane: SketchPlane, q: Vec3): [number, number] => {
  const d = sub(q, plane.origin)
  return [dot(d, plane.x), dot(d, plane.y)]
}
const flatten = (plane: SketchPlane, q: Vec3): Vec3 => {
  const n = cross(plane.x, plane.y)
  return sub(q, times(n, dot(sub(q, plane.origin), n)))
}

/** Whether a stroke the window sends is one the sketch had: same pen, build, plane and snaps, and the same points to within what main moved them by. */
function sameStroke(sent: NewStroke, kept: SketchStroke, sentPlanes: readonly SketchPlane[], keptPlanes: readonly SketchPlane[]): boolean {
  if (sent.pen !== kept.pen || sent.revision !== kept.revision || (sent.xray === true) !== (kept.xray === true) || sent.plane !== kept.plane) return false
  if (sent.plane !== undefined) {
    const a = planeById(sentPlanes, sent.plane)
    const b = planeById(keptPlanes, kept.plane)
    if (!a || !b || distance(a.origin, b.origin) > SAME_MM || distance(a.x, b.x) > 1e-6 || distance(a.y, b.y) > 1e-6 || !isDeepStrictEqual(a.from, b.from)) return false
  }
  const [mine, theirs] = sent.points ? [sent.points, kept.points] : [sent.points2d, kept.points2d]
  if (!mine || !theirs || mine.length !== theirs.length) return false
  if (!mine.every((p, i) => Math.hypot(...p.map((c, k) => c - (theirs[i] as number[])[k])) <= SAME_MM)) return false
  // `approx` is main's to say of an edge that is no line or circle: the window may not have it.
  const said = (snaps: SketchSnap[] | undefined): unknown[] => (snaps ?? []).map((s) => ({ ...s, approx: undefined }))
  return isDeepStrictEqual(said(sent.snaps), said(kept.snaps))
}

/**
 * The draft as main keeps it, or why not. `stored` is the sketch the draft changes (found by main from the window's id:
 * the draft's own `id` is never read), and `build` the last build.
 */
export function checkSketch(raw: unknown, stored: SketchMark | undefined, build: SketchBuild): SketchDraft | Refusal {
  if (!isRecord(raw)) return new Refusal('That is not a sketch.')
  if (typeof raw.objectId !== 'string' || raw.objectId === '') return new Refusal('A sketch is of a project, and this one names none.')
  if (typeof raw.layout !== 'string' || raw.layout === '' || raw.layout.length > 200) return new Refusal('A sketch is of a layout, and this one names none.')
  if (typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 0) return new Refusal('A sketch says which build it was drawn on, and this one does not.')
  if (raw.revision > build.revision) return new Refusal(`The sketch says it was drawn on build ${raw.revision}, and the last build is ${build.revision}.`)
  if (stored && raw.layout !== stored.layout) return new Refusal(`${stored.id} is a sketch of the layout ${stored.layout}: a sketch does not move to another layout.`)
  const camera = cameraOf(raw.camera)
  if (!camera) return new Refusal('A sketch keeps the camera it was drawn from, and this one has none.')
  if (typeof raw.note !== 'string') return new Refusal('The comment of a sketch is text.')
  // What the bar of a review said when the sketch was begun: a new sketch keeps it, one main has keeps its own.
  if (raw.intent !== undefined && raw.intent !== 'want' && raw.intent !== 'dont') return new Refusal('The intent of a sketch is want or dont, or none.')
  const body = readSketch(raw, 'window')
  if (typeof body === 'string') return new Refusal(`That is not a sketch: ${body}.`)
  // Ink on a tracing: the tracing is named once, by the sketch, and every plane is made from it. Whether it is there, of this layout, and its planes the tracing's own is `checkOnTracing`'s, asked once main has the tracings.
  if (raw.tracing !== undefined && !(typeof raw.tracing === 'string' && TRACING_ID.test(raw.tracing))) return new Refusal('The tracing of a sketch is a tracing id such as T1.')
  const tracing = raw.tracing === undefined ? stored?.tracing : raw.tracing
  if (stored?.tracing !== undefined && tracing !== stored.tracing) return new Refusal(`${stored.id} is ink on ${stored.tracing}: a sketch does not move to another tracing.`)
  for (const plane of body.planes) {
    if (plane.from.kind === 'tracing' && plane.from.tracing !== tracing) return new Refusal(`Plane ${plane.id} is the plane of ${plane.from.tracing}, and the sketch is ${tracing === undefined ? 'on no tracing' : `ink on ${tracing}`}.`)
    if (tracing !== undefined && plane.from.kind !== 'tracing') return new Refusal(`Plane ${plane.id} is not the plane of ${tracing}: ink on a tracing is drawn in its plane.`)
  }
  let anchor = raw.anchor === undefined ? undefined : anchorOf(raw.anchor)
  if (anchor === null) return new Refusal('The anchor of a sketch is a point.')
  // Where it was already tied, main has said how its part is spread and what it is: the window's is only its point.
  if (anchor && stored?.anchor && distance(anchor.point, stored.anchor.point) <= 1e-6) anchor = stored.anchor

  for (const plane of body.planes) {
    if (plane.from.kind === 'face' && plane.from.revision > build.revision) return new Refusal(`Plane ${plane.id} was made on build ${plane.from.revision}, and the last build is ${build.revision}.`)
    // A face of the last build is one it has: the index is within the part's faces. (Of an older build nothing is left to say.)
    if (plane.from.kind === 'face' && plane.from.revision === build.revision) {
      const [, name, index] = /^(.*)\/F(\d+)$/.exec(plane.from.ref) ?? []
      const part = name === undefined ? undefined : build.scene.parts.find((p) => p.layout === raw.layout && p.name === name)
      if (!part) return new Refusal(`Plane ${plane.id} is through ${plane.from.ref}, and build ${build.revision} has no such part in the layout ${raw.layout}.`)
      if (Number(index) >= part.faceCount) return new Refusal(`Plane ${plane.id} is through ${plane.from.ref}, and ${part.name} has ${part.faceCount} faces in build ${build.revision}.`)
    }
  }

  const unused = [...(stored?.strokes ?? [])]
  const strokes: Array<NewStroke | SketchStroke> = []
  for (const [n, stroke] of body.strokes.entries()) {
    // One the window names is the one the sketch has by that id, before any that is the same by value.
    const found = (kept: SketchStroke): boolean => sameStroke(stroke, kept, body.planes, stored?.planes ?? [])
    const named = unused.findIndex((kept) => kept.id === stroke.id && found(kept))
    const same = named >= 0 ? named : unused.findIndex(found)
    if (same >= 0) {
      strokes.push(structuredClone(unused[same]))
      unused.splice(same, 1)
      continue
    }
    if (stroke.revision !== build.revision) {
      return new Refusal(`Stroke ${n + 1} was drawn on build ${stroke.revision}, and the last build is ${build.revision}: a stroke that is new or changed is of the last build.`)
    }
    const checked = checkSnaps(stroke, n + 1, body.planes, raw.layout, build)
    if (checked instanceof Refusal) return checked
    strokes.push(checked)
  }

  return {
    objectId: raw.objectId,
    ...(stored ? { id: stored.id } : {}),
    layout: raw.layout,
    revision: raw.revision,
    camera,
    name: body.name,
    note: raw.note.slice(0, MAX_NOTE),
    take: body.take,
    ...(body.diameter === undefined ? {} : { diameter: body.diameter }),
    planes: body.planes,
    strokes,
    ...(anchor ? { anchor } : {}),
    ...(tracing === undefined ? {} : { tracing }),
    ...(!stored && raw.intent !== undefined ? { intent: raw.intent } : {})
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The snaps of a stroke.

/** The part a ref names (`block/V3`, `block/E14`): its name, the letter and the index. */
function parsed(ref: string): { name: string; index: number } {
  const at = ref.lastIndexOf('/')
  return { name: ref.slice(0, at), index: Number(ref.slice(at + 2)) }
}

/** A point of a part's own frame in the object frame. */
const placed = (part: Part, p: Vec3): Vec3 => add(rotate(part.loc.q, p), part.loc.t)

/**
 * The stroke with its snaps as main keeps them and every snapped point the kernel's own, or a refusal. A snap is of a
 * point of the stroke; its ref must be on the last build (a vertex, an edge, a circle); and the stroke's point must be
 * within `SNAP_MM` of what the snap data says (the point itself, or the point put on the stroke's plane, when `projected`),
 * which main then keeps in its place. A snap to an edge that is neither straight nor circular, or that says `approx`, is
 * checked for its ref only, and is said to be approximate.
 */
function checkSnaps(stroke: NewStroke, n: number, planes: readonly SketchPlane[], layout: string, build: SketchBuild): NewStroke | Refusal {
  if (!stroke.snaps || stroke.snaps.length === 0) {
    const { snaps: _none, ...bare } = stroke
    return bare
  }
  const plane = planeById(planes, stroke.plane)
  const points = stroke.points ? stroke.points.map((p): Vec3 => [...p]) : undefined
  const points2d = stroke.points2d ? stroke.points2d.map((p): [number, number] => [...p]) : undefined
  const seen = new Set<number>()
  const snaps: SketchSnap[] = []
  const cache = new Map<string, EdgeSource>()
  for (const snap of stroke.snaps) {
    if (seen.has(snap.i)) return new Refusal(`Point ${snap.i + 1} of stroke ${n} snaps twice.`)
    seen.add(snap.i)
    if (snap.projected && !plane) return new Refusal(`Point ${snap.i + 1} of stroke ${n} is said to be projected, and the stroke is on the surface.`)
    const at = `point ${snap.i + 1} of stroke ${n}`
    const ref = 'vertex' in snap ? snap.vertex : 'centre' in snap ? snap.centre : snap.edge
    const { name, index } = parsed(ref)
    const part = build.scene.parts.find((p) => p.layout === layout && p.name === name)
    if (!part) return new Refusal(`${ref}: the last build has no part ${name} in the layout ${layout}.`)
    const data = build.snap(name)
    if (!data) return new Refusal(`${ref}: ${name} has no snap data in the last build, so nothing of it can be snapped to.`)
    const sent = pointOf(stroke, plane, snap.i)
    const edges = (): EdgeSource => {
      let source = cache.get(name)
      if (!source) {
        source = edgeSource(part, build.blob, data)
        cache.set(name, source)
      }
      return source
    }

    let target: Vec3 | null = null
    let kept: SketchSnap = snap
    if ('vertex' in snap) {
      const vertex = vertexAt(data, index)
      if (!vertex) return new Refusal(`${ref} is not a vertex of ${name}: it has ${data.points.length / 3} vertices.`)
      target = placed(part, vertex)
      if (snap.projected && plane) target = flatten(plane, target)
    } else if ('centre' in snap) {
      const circle = circleOf(data, index)
      if (!circle) return new Refusal(`${ref} is not a circle: its edge is not circular.`)
      if (Math.abs(circle.radius - snap.radius) > SNAP_MM) return new Refusal(`${ref} has a radius of ${mm(circle.radius)} mm, not ${mm(snap.radius)}.`)
      target = placed(part, circle.centre)
      if (snap.projected && plane) target = flatten(plane, target)
    } else {
      if (!Number.isInteger(index) || index >= part.edgeCount) return new Refusal(`${ref}: ${name} has ${part.edgeCount} edges.`)
      const source = edges()
      const type = source.type(index)
      const circle = type === EDGE_CIRCLE ? circleOf(data, index) : null
      const ends = type === EDGE_LINE ? source.ends(index) : null
      if (snap.approx || (!circle && !ends)) {
        kept = { ...snap, approx: true }
      } else {
        const found = circle ? onCircle(part, circle, sent, snap.projected ? plane : undefined) : onSegment(part, ends as [Vec3, Vec3], sent, snap.projected ? plane : undefined)
        if (circle && source.polyline(index).every((s) => segmentDistance(found, s[0], s[1]) > tolerance(part.bbox))) {
          return new Refusal(`Point ${snap.i + 1} of stroke ${n} is on the circle of ${ref}, but not on the part of it the edge is.`)
        }
        target = snap.projected && plane ? flatten(plane, found) : found
      }
    }
    if (target) {
      const off = distance(sent, target)
      if (off > SNAP_MM) return new Refusal(`${at[0].toUpperCase()}${at.slice(1)} is ${mm(off)} mm from ${'centre' in snap ? 'the centre of ' : ''}${ref}: a snapped point is within ${SNAP_MM} mm of it.`)
      if (points) points[snap.i] = target
      else if (points2d && plane) points2d[snap.i] = onPlane(plane, target)
    }
    snaps.push(kept)
  }
  const { points: _p, points2d: _q, snaps: _s, ...rest } = stroke
  return { ...rest, ...(points ? { points } : {}), ...(points2d ? { points2d } : {}), snaps }
}

/** The exact point of a circle nearest to `p`, in the object frame; when the stroke is on a plane and the snap is projected, the point of it that lies nearest to `p` once put on that plane. */
function onCircle(part: Part, circle: { centre: Vec3; axis: Vec3; radius: number }, p: Vec3, plane: SketchPlane | undefined): Vec3 {
  const centre = placed(part, circle.centre)
  const axis = rotate(part.loc.q, circle.axis)
  if (!plane) return nearestOnCircle(centre, axis, circle.radius, p)
  // Put on a plane, a circle is an ellipse: look for the point of the circle whose shadow is nearest, around it.
  const u = orthogonal(axis)
  const w = cross(axis, u)
  const at = (t: number): Vec3 => add(centre, add(times(u, circle.radius * Math.cos(t)), times(w, circle.radius * Math.sin(t))))
  const away = (t: number): number => distance(flatten(plane, at(t)), p)
  const steps = 720
  let best = 0
  for (let k = 1; k < steps; k++) if (away((2 * Math.PI * k) / steps) < away((2 * Math.PI * best) / steps)) best = k
  let [lo, hi] = [(2 * Math.PI * (best - 1)) / steps, (2 * Math.PI * (best + 1)) / steps]
  for (let k = 0; k < 60; k++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (away(a) < away(b)) hi = b
    else lo = a
  }
  return at((lo + hi) / 2)
}

/** The point of a straight edge nearest to `p` (in the object frame); with a plane, the one whose shadow on the plane is nearest. */
function onSegment(part: Part, ends: [Vec3, Vec3], p: Vec3, plane: SketchPlane | undefined): Vec3 {
  const [a, b] = ends.map((e) => placed(part, e))
  const [fa, fb] = plane ? [flatten(plane, a), flatten(plane, b)] : [a, b]
  return add(a, times(sub(b, a), segmentParameter(fa, fb, p)))
}

function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  return distance(p, nearestOnSegment(a, b, p))
}

/** What the build's buffers say of a part's edges: each one's curve type, its two ends and its tessellated segments in the object frame. */
interface EdgeSource {
  type(edge: number): number
  /** The two ends of a straight edge, part-local: the ends of its polyline, set to the B-rep vertices that are there. */
  ends(edge: number): [Vec3, Vec3] | null
  /** Its segments, in the object frame. */
  polyline(edge: number): Array<[Vec3, Vec3]>
}

function edgeSource(part: Part, blob: ArrayBuffer, data: SnapData): EdgeSource {
  const types = bufView(blob, part.mesh.edgeTypes, Uint32Array)
  const counts = bufView(blob, part.mesh.segmentsPerEdge, Uint32Array)
  const edges = bufView(blob, part.mesh.edges, Float32Array)
  const starts: number[] = []
  let at = 0
  for (const count of counts) {
    starts.push(at)
    at += count
  }
  // The vertices in a grid of cells the size of the match, made once for the part and read when an edge's ends are looked for.
  let grid: Map<string, Vec3[]> | undefined
  const cell = (p: Vec3): number[] => p.map((c) => Math.floor(c / VERTEX_MATCH_MM))
  const vertexNear = (p: Vec3): Vec3 => {
    if (!grid) {
      grid = new Map()
      for (let i = 0; ; i++) {
        const v = vertexAt(data, i)
        if (!v) break
        const key = cell(v).join()
        grid.set(key, [...(grid.get(key) ?? []), v])
      }
    }
    const [x, y, z] = cell(p)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const found = grid.get([x + dx, y + dy, z + dz].join())?.find((v) => distance(v, p) <= VERTEX_MATCH_MM)
      if (found) return found
    }
    return p
  }
  const segment = (k: number): [Vec3, Vec3] => [
    [edges[6 * k], edges[6 * k + 1], edges[6 * k + 2]],
    [edges[6 * k + 3], edges[6 * k + 4], edges[6 * k + 5]]
  ]
  return {
    type: (edge) => types[edge] ?? -1,
    ends(edge) {
      if (!(counts[edge] > 0)) return null
      const first = segment(starts[edge])[0]
      const last = segment(starts[edge] + counts[edge] - 1)[1]
      return [vertexNear(first), vertexNear(last)]
    },
    polyline(edge) {
      return Array.from({ length: counts[edge] ?? 0 }, (_, k) => segment(starts[edge] + k).map((p) => placed(part, p)) as [Vec3, Vec3])
    }
  }
}
