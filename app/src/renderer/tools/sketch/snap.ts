import type { SketchPlane, SketchSnap, Vec3 } from '../../../shared/marks'
import { type SnapData, EDGE_CIRCLE, EDGE_LINE, circleOf, nearestOnCircle, nearestOnSegment, segmentParameter, vertexAt } from '../../../shared/snapdata'
import { planeNormal, toPlane } from './planes'

// What a pointer snaps to while sketching: the vertices of the parts, the centres of their holes, and their edges, within a
// few pixels of the pointer, in that order. Each is told by the ref the kernel numbers it by (`block/V88`, `head/E14`,
// `block/E40`), as the part's own `snapdata` has it. Everything works in the object frame; a part says how its own points get
// there (`toObject`), as the window's transform of it does.
//
// A point is exact where main can work it out again from the build (`main/sketches/check.ts`): a vertex, a circle's centre,
// a point on a straight edge (on the segment between the edge's ends) and a point on a circle (the nearest one). On any other
// edge it is told `approx`: it is a point of the drawn polyline.

/** What the pointer snaps to. `point` is in the object frame; `approx` is of an edge that is neither straight nor circular. */
export type Snap = { kind: 'vertex' | 'centre' | 'edge'; ref: string; point: Vec3; radius?: number; approx?: true }

/** One part of the scene as the index needs it: its snap data and edge buffers, part-local, and where it puts a point. */
export interface SnapPart {
  name: string
  toObject: (v: Vec3) => Vec3
  data: SnapData
  edges: Float32Array
  segmentsPerEdge: Uint32Array
  edgeTypes: Uint32Array
}

/** How far a snap may be from a plane before it is said to have been put on it, mm. A float's noise, and well within what main allows a snapped point (0.01 mm). */
const OFF_PLANE_MM = 1e-3
/** Cells to a side, at most, in the grid. */
const CELLS = 32
/** The most cells around a point of the ray that are looked in: further away than that, a pixel is a lot of millimetres and the pointer is not aiming. */
const MOST_AROUND = 3
/** The most cells a segment is put in: a long straight edge. */
const MOST_PER_SEGMENT = 200
/** Two things this close on the screen, in pixels, are one place, and the nearer along the ray wins. */
const SAME_PLACE_PX = 0.5

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v: Vec3): Vec3 => times(v, 1 / Math.hypot(...v))

/** How an edge is told: the circle it is (in the object frame) or the ends of its straight line, else it is approximate. */
type EdgeShape = { circle: { centre: Vec3; axis: Vec3; radius: number } } | { ends: [Vec3, Vec3] } | null

interface Cell {
  vertices: number[]
  centres: number[]
  segments: number[]
}

/**
 * The snap targets of a build, in a uniform grid of the object frame made once: `new SnapIndex(parts)` when the scene is
 * built, then `nearest` for every move of the pointer.
 */
export class SnapIndex {
  private readonly vertexPoints: Vec3[] = []
  private readonly vertexRefs: string[] = []
  private readonly centrePoints: Vec3[] = []
  private readonly centreRefs: string[] = []
  private readonly centreRadii: number[] = []
  /** Six numbers a segment, object frame; and the edge each is of. */
  private segmentPoints: number[] = []
  private readonly segmentEdge: number[] = []
  private readonly edgeRefs: string[] = []
  private readonly edgeShapes: EdgeShape[] = []
  private readonly min: Vec3 = [Infinity, Infinity, Infinity]
  private readonly max: Vec3 = [-Infinity, -Infinity, -Infinity]
  private size = 1
  private readonly cells = new Map<number, Cell>()
  private marks: Uint32Array[] = []
  private stamp = 0

  constructor(parts: SnapPart[]) {
    for (const part of parts) this.take(part)
    if (this.vertexPoints.length + this.centrePoints.length + this.segmentEdge.length === 0) return
    const span = Math.max(...this.max.map((c, i) => c - this.min[i]))
    this.size = Math.max(span / CELLS, 1e-6)
    this.vertexPoints.forEach((p, i) => this.cell(p, true).vertices.push(i))
    this.centrePoints.forEach((p, i) => this.cell(p, true).centres.push(i))
    for (let s = 0; s < this.segmentEdge.length; s++) this.put(s)
    this.marks = [new Uint32Array(this.vertexPoints.length), new Uint32Array(this.centrePoints.length), new Uint32Array(this.segmentEdge.length)]
  }

  /**
   * The nearest snap to `pointer` (screen px) within `radiusPx`, the ray being the one through the pointer, or null. A target
   * that `visible` says is not (hidden behind a part, or cut away) is passed over, and the next one is the answer; the index
   * knows nothing of what hides what, the view does.
   */
  nearest(ray: { origin: Vec3; dir: Vec3 }, project: (p: Vec3) => [number, number], pointer: [number, number], radiusPx = 10, visible?: (p: Vec3) => boolean): Snap | null {
    if (this.cells.size === 0) return null
    const seen = this.next()
    const away = (p: Vec3): number => {
      const [x, y] = project(p)
      return Math.hypot(x - pointer[0], y - pointer[1])
    }
    const depth = (p: Vec3): number => dot(sub(p, ray.origin), ray.dir)

    let vertex: { i: number; d: number; t: number } | null = null
    let centre: { i: number; d: number; t: number } | null = null
    let edge: { s: number; d: number; t: number; at: number } | null = null
    const better = (d: number, t: number, best: { d: number; t: number } | null): boolean => !best || d < best.d - SAME_PLACE_PX || (d <= best.d + SAME_PLACE_PX && t < best.t)

    for (const cell of this.cellsAlong(ray, project, radiusPx)) {
      for (const i of cell.vertices) {
        if (this.marks[0][i] === seen) continue
        this.marks[0][i] = seen
        const d = away(this.vertexPoints[i])
        if (d <= radiusPx && better(d, depth(this.vertexPoints[i]), vertex) && (!visible || visible(this.vertexPoints[i]))) vertex = { i, d, t: depth(this.vertexPoints[i]) }
      }
      for (const i of cell.centres) {
        if (this.marks[1][i] === seen) continue
        this.marks[1][i] = seen
        const d = away(this.centrePoints[i])
        if (d <= radiusPx && better(d, depth(this.centrePoints[i]), centre) && (!visible || visible(this.centrePoints[i]))) centre = { i, d, t: depth(this.centrePoints[i]) }
      }
      for (const s of cell.segments) {
        if (this.marks[2][s] === seen) continue
        this.marks[2][s] = seen
        const found = this.onScreen(s, project, pointer)
        if (found.d > radiusPx) continue
        const t = found.t
        const p = this.segmentAt(s, t)
        if (better(found.d, depth(p), edge) && (!visible || visible(p))) edge = { s, d: found.d, t: depth(p), at: t }
      }
    }
    if (vertex) return { kind: 'vertex', ref: this.vertexRefs[vertex.i], point: this.vertexPoints[vertex.i] }
    if (centre) return { kind: 'centre', ref: this.centreRefs[centre.i], point: this.centrePoints[centre.i], radius: this.centreRadii[centre.i] }
    if (edge) return this.edgeSnap(edge.s, this.segmentAt(edge.s, edge.at))
    return null
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Building.

  private take(part: SnapPart): void {
    const grow = (p: Vec3): void => {
      for (let i = 0; i < 3; i++) {
        this.min[i] = Math.min(this.min[i], p[i])
        this.max[i] = Math.max(this.max[i], p[i])
      }
    }
    for (let i = 0; ; i++) {
      const v = vertexAt(part.data, i)
      if (!v) break
      const p = part.toObject(v)
      grow(p)
      this.vertexPoints.push(p)
      this.vertexRefs.push(`${part.name}/V${i}`)
    }
    const { circles } = part.data
    for (let k = 0; k + 8 <= circles.length; k += 8) {
      const p = part.toObject([circles[k + 1], circles[k + 2], circles[k + 3]])
      grow(p)
      this.centrePoints.push(p)
      this.centreRefs.push(`${part.name}/E${circles[k]}`)
      this.centreRadii.push(circles[k + 7])
    }
    let at = 0
    for (let e = 0; e < part.segmentsPerEdge.length; e++) {
      const count = part.segmentsPerEdge[e]
      const edge = this.edgeRefs.length
      this.edgeRefs.push(`${part.name}/E${e}`)
      for (let s = 0; s < count; s++, at++) {
        const a = part.toObject([part.edges[6 * at], part.edges[6 * at + 1], part.edges[6 * at + 2]])
        const b = part.toObject([part.edges[6 * at + 3], part.edges[6 * at + 4], part.edges[6 * at + 5]])
        grow(a)
        grow(b)
        this.segmentPoints.push(...a, ...b)
        this.segmentEdge.push(edge)
      }
      this.edgeShapes.push(count > 0 ? this.shapeOf(part, e, part.edgeTypes[e], this.segmentPoints, this.segmentEdge.length - count, this.segmentEdge.length - 1) : null)
    }
  }

  private shapeOf(part: SnapPart, edge: number, type: number, points: number[], first: number, last: number): EdgeShape {
    if (type === EDGE_CIRCLE) {
      const c = circleOf(part.data, edge)
      if (!c) return null
      const centre = part.toObject(c.centre)
      const axis = unit(sub(part.toObject(add(c.centre, c.axis)), centre))
      return { circle: { centre, axis, radius: c.radius } }
    }
    if (type === EDGE_LINE) return { ends: [[points[6 * first], points[6 * first + 1], points[6 * first + 2]], [points[6 * last + 3], points[6 * last + 4], points[6 * last + 5]]] }
    return null
  }

  private cell(p: Vec3, make: boolean): Cell {
    const key = this.key(p.map((c, i) => Math.floor((c - this.min[i]) / this.size)) as Vec3)
    let cell = this.cells.get(key)
    if (!cell && make) this.cells.set(key, (cell = { vertices: [], centres: [], segments: [] }))
    return cell as Cell
  }

  /** A cell's number from its three indices; -1 for a place outside the grid (the box of the parts, and a few cells of margin round it). */
  private key([x, y, z]: Vec3): number {
    return x < 0 || y < 0 || z < 0 || x >= 1024 || y >= 1024 || z >= 1024 ? -1 : x + 1024 * (y + 1024 * z)
  }

  /** The segment in every cell it passes through. */
  private put(s: number): void {
    const a: Vec3 = [this.segmentPoints[6 * s], this.segmentPoints[6 * s + 1], this.segmentPoints[6 * s + 2]]
    const b: Vec3 = [this.segmentPoints[6 * s + 3], this.segmentPoints[6 * s + 4], this.segmentPoints[6 * s + 5]]
    const steps = Math.min(MOST_PER_SEGMENT, Math.max(1, Math.ceil(Math.hypot(...sub(b, a)) / (this.size / 2))))
    const seen = new Set<number>()
    for (let k = 0; k <= steps; k++) {
      const p = add(a, times(sub(b, a), k / steps))
      const key = this.key(p.map((c, i) => Math.floor((c - this.min[i]) / this.size)) as Vec3)
      if (seen.has(key)) continue
      seen.add(key)
      this.cell(p, true).segments.push(s)
    }
  }

  /** A number no earlier query used, to mark what it has looked at. */
  private next(): number {
    if (this.stamp >= 0xfffffffe) {
      this.marks.forEach((m) => m.fill(0))
      this.stamp = 0
    }
    return ++this.stamp
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Looking.

  /** The cells within reach of the ray: those around points taken along it through the box of the parts, as many around each as a pixel radius is millimetres there. */
  private cellsAlong(ray: { origin: Vec3; dir: Vec3 }, project: (p: Vec3) => [number, number], radiusPx: number): Cell[] {
    const pad = this.size * (MOST_AROUND + 1)
    const [t0, t1] = slab(ray, this.min.map((c) => c - pad) as Vec3, this.max.map((c) => c + pad) as Vec3)
    if (!(t1 >= t0)) return []
    const dir = unit(ray.dir)
    const side = unit(Math.abs(dir[2]) < 0.9 ? cross(dir, [0, 0, 1]) : cross(dir, [1, 0, 0]))
    const up = cross(dir, side)
    const found = new Map<number, Cell>()
    const step = this.size / 2
    const steps = Math.min(400, Math.ceil((t1 - t0) / step))
    for (let k = 0; k <= steps; k++) {
      const p = add(ray.origin, times(dir, t0 + ((t1 - t0) * k) / Math.max(steps, 1)))
      // Pixels to the millimetre here, so the radius in pixels is a radius in cells.
      const [x, y] = project(p)
      const [sx, sy] = project(add(p, times(side, this.size)))
      const [ux, uy] = project(add(p, times(up, this.size)))
      const perCell = Math.max(Math.hypot(sx - x, sy - y), Math.hypot(ux - x, uy - y))
      const around = perCell > 0 ? Math.min(MOST_AROUND, Math.max(1, Math.ceil(radiusPx / perCell))) : 1
      const at = p.map((c, i) => Math.floor((c - this.min[i]) / this.size)) as Vec3
      for (let dx = -around; dx <= around; dx++) for (let dy = -around; dy <= around; dy++) for (let dz = -around; dz <= around; dz++) {
        const key = this.key([at[0] + dx, at[1] + dy, at[2] + dz])
        const cell = key < 0 ? undefined : this.cells.get(key)
        if (cell) found.set(key, cell)
      }
    }
    return [...found.values()]
  }

  /** How far a segment is from the pointer on the screen, and where along it the nearest point is (0 to 1). */
  private onScreen(s: number, project: (p: Vec3) => [number, number], pointer: [number, number]): { d: number; t: number } {
    const [ax, ay] = project([this.segmentPoints[6 * s], this.segmentPoints[6 * s + 1], this.segmentPoints[6 * s + 2]])
    const [bx, by] = project([this.segmentPoints[6 * s + 3], this.segmentPoints[6 * s + 4], this.segmentPoints[6 * s + 5]])
    const t = segmentParameter([ax, ay, 0], [bx, by, 0], [pointer[0], pointer[1], 0])
    return { d: Math.hypot(ax + (bx - ax) * t - pointer[0], ay + (by - ay) * t - pointer[1]), t }
  }

  private segmentAt(s: number, t: number): Vec3 {
    const q = this.segmentPoints
    return [q[6 * s] + (q[6 * s + 3] - q[6 * s]) * t, q[6 * s + 1] + (q[6 * s + 4] - q[6 * s + 1]) * t, q[6 * s + 2] + (q[6 * s + 5] - q[6 * s + 2]) * t]
  }

  /** The snap on the edge a segment is of, at a point of the segment: on the edge's true line or circle where it is one, else approximate. */
  private edgeSnap(s: number, found: Vec3): Snap {
    const edge = this.segmentEdge[s]
    const ref = this.edgeRefs[edge]
    const shape = this.edgeShapes[edge]
    if (shape && 'circle' in shape) return { kind: 'edge', ref, point: nearestOnCircle(shape.circle.centre, shape.circle.axis, shape.circle.radius, found) }
    if (shape) return { kind: 'edge', ref, point: nearestOnSegment(shape.ends[0], shape.ends[1], found) }
    return { kind: 'edge', ref, point: found, approx: true }
  }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Where a ray is inside a box, as distances along it (from 0); `[1, 0]` when it never is. */
function slab(ray: { origin: Vec3; dir: Vec3 }, min: Vec3, max: Vec3): [number, number] {
  let t0 = 0
  let t1 = Infinity
  for (let i = 0; i < 3; i++) {
    const o = ray.origin[i]
    const d = ray.dir[i]
    if (Math.abs(d) < 1e-12) {
      if (o < min[i] || o > max[i]) return [1, 0]
      continue
    }
    const a = (min[i] - o) / d
    const b = (max[i] - o) / d
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  return [t0, t1]
}

/**
 * A snap on a plane: its point put on the plane along the plane's normal, in the plane's own axes, and whether that moved it
 * (more than `OFF_PLANE_MM`), which the sketch then says (`projected`).
 */
export function projectOnto(plane: Pick<SketchPlane, 'origin' | 'x' | 'y'>, snap: Snap): { uv: [number, number]; projected: boolean } {
  const [u, v] = toPlane(plane, snap.point)
  const off = dot(sub(snap.point, plane.origin), planeNormal(plane))
  return { uv: [u + 0, v + 0], projected: Math.abs(off) > OFF_PLANE_MM }
}

/** The snap of the point numbered `i` of a stroke, as a sketch keeps it. */
export function toSketchSnap(i: number, snap: Snap, projected: boolean): SketchSnap {
  const flag = projected ? { projected: true as const } : {}
  if (snap.kind === 'vertex') return { i, vertex: snap.ref, ...flag }
  if (snap.kind === 'centre') return { i, centre: snap.ref, radius: snap.radius as number, ...flag }
  return { i, edge: snap.ref, ...(snap.approx ? { approx: true as const } : {}), ...flag }
}
