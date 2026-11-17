import { TRACING_ID } from '../../shared/tracings'
import { MAX_SKETCH_DIAMETER, MAX_SKETCH_NAME, MAX_STROKE_POINTS, MOST_SKETCH_PLANES, MOST_SKETCH_POINTS, MOST_SKETCH_STROKES, type SketchPlane, type SketchPlaneFrom, type NewStroke, type SketchSnap, type SketchStroke, type SketchTake, type Vec3, STROKE_ID } from '../../shared/marks'

// What a sketch is made of, read from a value that is not yet known to be one: from `marks.json` (`sanitiseMark`) and from
// the window (`checkSketch`). One reading for both, so that what the window may send is what the file may hold. It answers
// the parts of the sketch as they are kept, or a sentence that says what is wrong with it.

export interface SketchBody {
  name: string
  take: SketchTake
  diameter?: number
  planes: SketchPlane[]
  /** As read: a stroke's `id` is kept when it is well-formed (`STROKE_ID`), and is a claim only (`numberStrokes`, `MarkStore.saveSketch`). */
  strokes: NewStroke[]
}

/**
 * The strokes of a sketch kept in a file, numbered. An id that is well-formed and not used before keeps it; any other
 * stroke (none, malformed, a repeat) is numbered above the highest id there is and above `next`, the file's own count, in
 * order: a sketch from before ids is `k1…kn` and reads the same every time. `nextStroke` is where the count stands after.
 */
export function numberStrokes(strokes: readonly NewStroke[], next: unknown): { strokes: SketchStroke[]; nextStroke: number } {
  const seen = new Set<string>()
  let top = 0
  for (const stroke of strokes) {
    if (typeof stroke.id !== 'string' || !STROKE_ID.test(stroke.id) || seen.has(stroke.id)) continue
    seen.add(stroke.id)
    top = Math.max(top, Number(stroke.id.slice(1)))
  }
  let count = Math.max(top + 1, isWhole(next) ? next : 1)
  const used = new Set<string>()
  const numbered = strokes.map((stroke): SketchStroke => {
    if (typeof stroke.id === 'string' && seen.has(stroke.id) && !used.has(stroke.id)) {
      used.add(stroke.id)
      return stroke as SketchStroke
    }
    return { ...stroke, id: `k${count++}` }
  })
  return { strokes: numbered, nextStroke: count }
}

/** How far the axes of a plane may be from a frame, and still be set right (`orthonormal`). */
export const FRAME_TOLERANCE = 1e-6
/** The longest label a plane keeps, and the longest ref. */
const MAX_LABEL = 120
const MAX_REF = 200
/** The most faces a stroke names that it touches. */
const MOST_TOUCHES = 64

const VERTEX_REF = /^[^\s/]{1,200}\/V\d{1,9}$/
const EDGE_REF = /^[^\s/]{1,200}\/E\d{1,9}$/
const FACE_REF = /^[^\s/]{1,200}\/F\d{1,9}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const tuple = <T extends number[]>(value: unknown, length: T['length']): T | null => (Array.isArray(value) && value.length === length && value.every(isNumber) ? ([...value] as T) : null)

/** Text on one line: line breaks become a space, and the ends are trimmed. */
export const oneLine = (text: string): string => text.replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, ' ').trim()

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * The two axes of a plane as an orthonormal pair: the same when they are one already (to 1e-12), set right when they are
 * within `FRAME_TOLERANCE` of it (lengths of one, a right angle between), and null when they are worse than that.
 */
export function orthonormal(x: Vec3, y: Vec3): [Vec3, Vec3] | null {
  const off = [Math.abs(Math.hypot(...x) - 1), Math.abs(Math.hypot(...y) - 1), Math.abs(dot(x, y))]
  if (!off.every((o) => o <= FRAME_TOLERANCE)) return null
  if (off.every((o) => o <= 1e-12)) return [x, y]
  const lx = Math.hypot(...x)
  const ux: Vec3 = [x[0] / lx, x[1] / lx, x[2] / lx]
  const along = dot(y, ux)
  const rest: Vec3 = [y[0] - along * ux[0], y[1] - along * ux[1], y[2] - along * ux[2]]
  const lr = Math.hypot(...rest)
  return [ux, [rest[0] / lr, rest[1] / lr, rest[2] / lr]]
}

/**
 * The sketch's own parts. `from` is where it is read: `file` is a mark kept (what main keeps of a stroke, its touches, is
 * read; a name or a stroke over its caps is no sketch), `window` is a draft (its touches are not read, and a name over its
 * cap is refused rather than cut). `id` names a sketch that is given none.
 */
export function readSketch(value: Record<string, unknown>, from: 'file' | 'window', id?: string): SketchBody | string {
  const name = typeof value.name === 'string' ? oneLine(value.name) : value.name === undefined ? '' : null
  if (name === null) return 'its name is not text'
  if (name.length > MAX_SKETCH_NAME && from === 'window') return `its name has more than ${MAX_SKETCH_NAME} characters`
  const take = value.take === undefined ? 'rough' : value.take
  if (take !== 'exact' && take !== 'rough' && take !== 'flow') return 'its take is exact, rough or flow'
  let diameter: number | undefined
  if (value.diameter !== undefined) {
    if (take !== 'flow') return 'only a flow sketch has a diameter'
    if (!isNumber(value.diameter) || !(value.diameter > 0) || value.diameter > MAX_SKETCH_DIAMETER) return `its diameter is more than 0 and at most ${MAX_SKETCH_DIAMETER} mm`
    diameter = value.diameter
  }
  if (!Array.isArray(value.planes) || !Array.isArray(value.strokes)) return 'it has no planes and strokes'
  if (value.planes.length > MOST_SKETCH_PLANES) return `it has more than ${MOST_SKETCH_PLANES} planes`
  const planes: SketchPlane[] = []
  for (const raw of value.planes) {
    const plane = planeOf(raw)
    if (typeof plane === 'string') return plane
    if (planes.some((p) => p.id === plane.id)) return `two of its planes are numbered ${plane.id}`
    planes.push(plane)
  }
  if (value.strokes.length > MOST_SKETCH_STROKES) return `it has more than ${MOST_SKETCH_STROKES} strokes`
  const strokes: NewStroke[] = []
  let points = 0
  for (const [n, raw] of value.strokes.entries()) {
    const stroke = strokeOf(raw, n + 1, planes, from)
    if (typeof stroke === 'string') return stroke
    points += (stroke.points ?? stroke.points2d ?? []).length
    if (points > MOST_SKETCH_POINTS) return `it has more than ${MOST_SKETCH_POINTS} points`
    strokes.push(stroke)
  }
  return {
    name: name === '' && id !== undefined ? `Sketch ${id}` : name.slice(0, MAX_SKETCH_NAME),
    take,
    ...(diameter === undefined ? {} : { diameter }),
    planes,
    strokes
  }
}

function planeOf(value: unknown): SketchPlane | string {
  if (!isRecord(value) || !isWhole(value.id) || value.id < 1) return 'a plane has no number'
  const origin = tuple<Vec3>(value.origin, 3)
  const x = tuple<Vec3>(value.x, 3)
  const y = tuple<Vec3>(value.y, 3)
  if (!origin || !x || !y) return `plane ${value.id} has an origin or an axis that is not three finite numbers`
  const frame = orthonormal(x, y)
  if (!frame) return `plane ${value.id} is not a plane: its axes are not each of length one, at a right angle`
  if (typeof value.label !== 'string') return `plane ${value.id} has no label`
  const from = fromOf(value.from)
  if (!from) return `plane ${value.id} does not say how it was made`
  return { id: value.id, origin, x: frame[0], y: frame[1], label: oneLine(value.label).slice(0, MAX_LABEL), from }
}

function fromOf(value: unknown): SketchPlaneFrom | null {
  if (!isRecord(value)) return null
  switch (value.kind) {
    case 'main':
      return (value.axis === 'XY' || value.axis === 'XZ' || value.axis === 'YZ') && isNumber(value.offset) ? { kind: 'main', axis: value.axis, offset: value.offset } : null
    case 'face':
      return typeof value.ref === 'string' && FACE_REF.test(value.ref) && isNumber(value.offset) && isWhole(value.revision) ? { kind: 'face', ref: value.ref, offset: value.offset, revision: value.revision } : null
    case 'point': {
      const point = tuple<Vec3>(value.point, 3)
      const normal = tuple<Vec3>(value.normal, 3)
      return point && normal && isNumber(value.offset) ? { kind: 'point', point, normal, offset: value.offset } : null
    }
    case 'tracing':
      return typeof value.tracing === 'string' && TRACING_ID.test(value.tracing) ? { kind: 'tracing', tracing: value.tracing } : null
    case 'view':
      return typeof value.label === 'string' ? { kind: 'view', label: oneLine(value.label).slice(0, MAX_LABEL) } : null
    default:
      return null
  }
}

function strokeOf(value: unknown, n: number, planes: SketchPlane[], from: 'file' | 'window'): NewStroke | string {
  if (!isRecord(value)) return `stroke ${n} is not a stroke`
  if (value.pen !== 'free' && value.pen !== 'line' && value.pen !== 'points') return `stroke ${n} has no pen: free, line or points`
  if (!isWhole(value.revision)) return `stroke ${n} does not say which build it was drawn on`
  const stroke: NewStroke = { pen: value.pen, revision: value.revision }
  if (typeof value.id === 'string' && STROKE_ID.test(value.id)) stroke.id = value.id
  let count: number
  if (value.plane !== undefined) {
    if (!isWhole(value.plane) || !planes.some((p) => p.id === value.plane)) return `stroke ${n} is on plane ${String(value.plane)}, which the sketch has not`
    if (value.points !== undefined || !Array.isArray(value.points2d)) return `stroke ${n} is on a plane and has points2d, not points`
    if (value.points2d.length > MAX_STROKE_POINTS) return `stroke ${n} has more than ${MAX_STROKE_POINTS} points`
    const points2d = value.points2d.map((p) => tuple<[number, number]>(p, 2))
    if (points2d.length === 0 || points2d.some((p) => p === null)) return `stroke ${n} has a point that is not two finite numbers, or none`
    stroke.plane = value.plane
    stroke.points2d = points2d as [number, number][]
    count = points2d.length
  } else {
    if (value.points2d !== undefined || !Array.isArray(value.points)) return `stroke ${n} is on the surface and has points, not points2d`
    if (value.points.length > MAX_STROKE_POINTS) return `stroke ${n} has more than ${MAX_STROKE_POINTS} points`
    const points = value.points.map((p) => tuple<Vec3>(p, 3))
    if (points.length === 0 || points.some((p) => p === null)) return `stroke ${n} has a point that is not three finite numbers, or none`
    stroke.points = points as Vec3[]
    count = points.length
  }
  if (value.snaps !== undefined) {
    if (!Array.isArray(value.snaps) || value.snaps.length > count) return `stroke ${n} has more snaps than points`
    const snaps: SketchSnap[] = []
    for (const raw of value.snaps) {
      const snap = snapOf(raw, count)
      if (!snap) return `stroke ${n} has a snap that is not of one of its points, or does not name a vertex, an edge or a centre`
      snaps.push(snap)
    }
    if (snaps.length > 0) stroke.snaps = snaps
  }
  if (value.xray === true) stroke.xray = true
  if (from === 'file' && Array.isArray(value.touches)) {
    stroke.touches = value.touches.filter((ref): ref is string => typeof ref === 'string' && ref.length <= MAX_REF).slice(0, MOST_TOUCHES)
  }
  return stroke
}

function snapOf(value: unknown, points: number): SketchSnap | null {
  if (!isRecord(value) || !isWhole(value.i) || value.i >= points) return null
  const named = ['vertex', 'centre', 'edge'].filter((key) => value[key] !== undefined)
  if (named.length !== 1) return null
  const projected = value.projected === true ? { projected: true as const } : {}
  if (named[0] === 'vertex') return typeof value.vertex === 'string' && VERTEX_REF.test(value.vertex) ? { i: value.i, vertex: value.vertex, ...projected } : null
  if (named[0] === 'centre') return typeof value.centre === 'string' && EDGE_REF.test(value.centre) && isNumber(value.radius) && value.radius > 0 ? { i: value.i, centre: value.centre, radius: value.radius, ...projected } : null
  if (typeof value.edge !== 'string' || !EDGE_REF.test(value.edge)) return null
  return { i: value.i, edge: value.edge, ...(value.approx === true ? { approx: true as const } : {}), ...projected }
}
