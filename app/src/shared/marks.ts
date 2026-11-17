import type { StrokeUnder } from './drawing'
import type { Camera } from './view'
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]            // x y z w

export interface Anchor {
  point: Vec3
  normal?: Vec3
  part?: string            // part name; absent for a point in empty space
  ref?: string             // `lid` | `lid/F12` | `lid/E3`, refreshed after each build; never `lid/@top` (a tag is kept in `tag`)
  descriptor?: string      // from the kernel: "plane, normal +Z, z = 20, 1180 mm²"
  /**
   * How far its part had been spread for display (`Part.arranged`) on the build
   * the anchor was placed on or last checked against: zeros for a part that
   * was not moved. Main sets it. When a later build spreads the part
   * otherwise, the mark is moved by the difference, so it stays where it was
   * put on the part. Absent: never recorded (a mark from before this was
   * kept, or one on no part), and the next check records it without moving
   * the mark.
   */
  arranged?: Vec3
  /** The edge the point is on, when it is on one: `lid/E40`. Then `ref` is that edge too. */
  edge?: string
  /** The two faces that meet at `edge`: `['lid/F12', 'lid/F40']`. */
  between?: [string, string]
  /**
   * The tag the model gives the face or edge `ref` names (`top` of `lid/@top`; `tags(p, parts)`), when it names that
   * one and no other. Set by main when the mark is placed and refreshed by every check: while the build still has
   * the tag, the anchor follows it (`ref` is what the tag names now) before the nearest-point rule is asked. Never
   * taken from the window or from a tool.
   */
  tag?: string
}
export type MarkStatus = 'draft' | 'sent' | 'resolved'
export type AnchorState = 'ok' | 'drifted' | 'orphaned'
export type ShapeKind = 'box' | 'cylinder' | 'sphere' | 'plane'
export type ShapeIntent = 'add' | 'remove' | 'keep-out' | 'reference'

interface MarkBase {
  id: string               // 'M3'
  author: 'user' | 'agent'
  note: string
  status: MarkStatus
  anchorState: AnchorState
  layout: string
  revision: number         // build it was placed on
  camera: Camera           // the view it was placed from
  createdAt: string        // ISO
  resolvedNote?: string
  /** Who resolved it. Set by main, on a mark that is resolved. */
  resolvedBy?: 'user' | 'agent'
  /** The person has seen that the agent resolved it. Only ever true, on a mark the agent resolved. */
  acknowledged?: boolean
  /** It has been given to the agent with a prompt at least once. Set by main; only ever true. */
  sentBefore?: boolean
  /**
   * The person made it a draft again after it was resolved, and the agent has
   * not been told since: its resolution was not accepted. Set by main, on a
   * draft; only ever true, and gone once the mark is sent.
   */
  reopened?: boolean
  /**
   * The revision of the last build its anchors were checked against. Set by
   * main. Absent: not checked in this run of torno. Revisions count from 1
   * each time an object is opened, so what a file says of an earlier run is
   * dropped when it is read.
   */
  checkedRevision?: number
}
export interface PinMark extends MarkBase { kind: 'pin'; anchor: Anchor }
export interface PickMark extends MarkBase { kind: 'pick'; target: 'face' | 'edge' | 'part'; anchor: Anchor }
export interface ArrowMark extends MarkBase { kind: 'arrow'; from: Anchor; to: Vec3 }
export interface StrokeMark extends MarkBase {
  kind: 'stroke'
  space: 'surface' | 'plane'
  anchor: Anchor                                         // first point
  points?: Vec3[]                                        // surface strokes
  plane?: { origin: Vec3; x: Vec3; y: Vec3; label: string }   // label: "XZ at y = 40.0"
  points2d?: [number, number][]                          // plane strokes, mm in plane axes
}
export interface ShapeMark extends MarkBase {
  kind: 'shape'
  shape: ShapeKind
  intent: ShapeIntent
  position: Vec3
  rotation: Quat
  size: Vec3               // box: x y z; cylinder: diameter, diameter, height; sphere: diameter ×3; plane: width, height, 0
  anchor?: Anchor          // where it was first placed
}
export type MeasureKind = 'distance' | 'angle' | 'radius' | 'diameter' | 'thickness'
/**
 * A measurement that stays: an exact value from the kernel between its ends,
 * and, when the person says what it should be, whether it is. Like any mark
 * it is a draft until the agent has been given it; while it is not resolved
 * it is "pinned": it stays in the list, and is measured again on every build
 * (`measuredRevision` says on which its value was taken).
 */
/** What the kernel said of a dimension on one build of this run: its value, or none when it had none there. */
export interface DimensionSample {
  revision: number
  value?: number
}
export interface DimensionMark extends MarkBase {
  kind: 'dimension'
  measure: MeasureKind
  a: Anchor                 // first end; for radius, diameter and thickness the only one
  b?: Anchor                // second end, for distance and angle
  value?: number            // mm or degrees, as last measured by the kernel; absent when not measurable
  how?: string              // "between planes" | "axis to axis" | "point to plane" | "minimum" | "wall, along the normal" | ...
  measuredRevision?: number // this run's build the kernel last said of it on, a value or that there is none (dropped on load, like checkedRevision)
  refused?: string          // why the kernel could not measure it, in its words; only without a value
  expected?: number
  tolerance?: number        // default 0.05 mm, 0.1°
  verdict?: 'pass' | 'fail' // present when expected is set and value is known
  points?: [Vec3, Vec3]     // the two points the value was taken between, for drawing the dimension line
  /**
   * What it measured on each of the last builds of this run, oldest first (`withSample`). Main's alone, and only in
   * its memory: it is told to the window with the marks and never written to marks.json, for revisions count from 1
   * in every run. No caller supplies it, and the verdict of each sample is worked out from the expectation as it now is.
   */
  history?: DimensionSample[]
}
/**
 * A part of a scan the person painted, and named with its note: "wiring loom, can be pushed aside". Its
 * triangles are a bitset beside the scan's mesh (`.torno/scans/<scan>/<id>.mask`), which only main writes.
 * It is tied to no part and to no build: its `anchorState` follows its scan, `orphaned` once that is removed
 * or its mesh is another than the one the region was painted on. It is of its scan in every layout: `layout`
 * is only where it was painted.
 */
export interface RegionMark extends MarkBase {
  kind: 'region'
  scan: string                 // 'S1'
  triangles: number
  area: number                 // mm², of the mesh as imported (times s² where a fit scaled the scan)
  /** In the scan's own frame, which is why it is named `local`: where the region is in a layout is worked out from the scan's transform there. */
  local: {
    centroid: Vec3               // area-weighted
    bbox: { min: Vec3; max: Vec3 }
    plane: { origin: Vec3; normal: Vec3; rms: number }   // best fit through the triangles' centroids
    /** The box it fills along its own axes: its middle, the three axes (longest side first, each of length one) and half its size along each. */
    box: { centre: Vec3; axes: [Vec3, Vec3, Vec3]; half: Vec3 }
  }
  /** Which mesh of its scan it was painted on (`meshIdentity`). Main's alone; absent on a mark from before it was recorded. */
  mesh?: string
  /** Which painting of it its mask holds, once it was painted again (`maskStem`): the file is `<id>.<n>.mask`. Main's alone. */
  mask?: number
}
/** What main alone says of a region, from the scan's mesh and the mask: no caller supplies these. */
export const REGION_KEYS = ['triangles', 'area', 'local', 'mesh', 'mask'] as const
/** The most labels a note keeps, the longest label, the most reference pictures and the longest comment on one. */
export const MOST_LABELS = 20
export const MAX_LABEL = 200
export const MOST_NOTE_REFERENCES = 6
export const MAX_REFERENCE_COMMENT = 300
/** The longest note a mark keeps, in characters: a note's own comment is held to it as well. */
export const MAX_NOTE = 2000
/** A stroke of a note, in pixels of its picture: a pen stroke, or (`erase`) an eraser stroke, which rubs out what the strokes before it drew. */
export interface NoteStroke {
  width: number
  points: Array<[number, number]>
  erase?: true
}
/** The pen strokes of a note's strokes: the ones that are ink, numbered from 1 for what is said of them. An eraser stroke lies over nothing and is not among them. */
export const penStrokes = <S extends { erase?: true }>(strokes: readonly S[]): S[] => strokes.filter((s) => s.erase !== true)
/** The most strokes of ink a note keeps: a person hatching a part must not lose a note. Only `MOST_STROKES_TOLD` of them get a line of what they lie over; the rest are counted. */
export const MOST_NOTE_STROKES = 2000
/** The most eraser strokes a note keeps, besides its strokes of ink. */
export const MOST_NOTE_ERASES = 2000
/** The files of a note, in `<object>/.torno/notes/`: named by main alone. The plain picture of the view, the picture with the ink on it, and a reference picture. */
export const NOTE_PICTURE = /^n-[0-9a-f]{12}\.png$/
export const NOTE_INK = /^n-[0-9a-f]{12}\.ink\.png$/
export const NOTE_REFERENCE = /^r-[0-9a-f]{12}\.(png|jpg)$/
/** The picture of a sketch's card, kept beside the notes' pictures: named by main alone. */
export const SKETCH_PICTURE = /^k-[0-9a-f]{12}\.png$/
/** What a sketch keeps: the longest name, the most strokes, the most points in all (a stroke keeps `MAX_STROKE_POINTS`), the most planes, the biggest diameter (mm). */
export const MAX_SKETCH_NAME = 80
export const MOST_SKETCH_STROKES = 200
export const MOST_SKETCH_POINTS = 20000
export const MOST_SKETCH_PLANES = 50
export const MAX_SKETCH_DIAMETER = 500

/** A word on the picture of a note, at a point of it in pixels, with an arrow to another point when it has one. */
export interface NoteLabel {
  x: number
  y: number
  text: string
  to?: { x: number; y: number }
}
/** A picture the person gave with a note, kept as `r-<12 hex>.<png|jpg>`, and what they say it is. */
export interface NoteReference {
  file: string
  comment: string
}
/**
 * A picture of the view with the person's ink on it, labels with arrows, a comment (`note`) and reference pictures.
 * Its pictures are files of main's beside the marks (`picture`, `ink`, each reference's `file`), never in marks.json.
 * The strokes and labels are in pixels of the picture (`size`) and stay the source: an edit makes a new inked file.
 * Its anchor is where the ink first lies over a face, when it does: like a pick's, but optional.
 */
export interface NoteMark extends MarkBase {
  kind: 'note'
  anchor?: Anchor
  /** The plain picture of the view: `n-<12 hex>.png`. */
  picture: string
  /** The picture with the ink on it: `n-<12 hex>.ink.png`. */
  ink: string
  size: { w: number; h: number }
  strokes: NoteStroke[]
  /** The ink, `#rrggbb`. */
  inkColour: string
  labels: NoteLabel[]
  /** What the ink lies over: one per stroke, then one per label that has an arrow. */
  under: StrokeUnder[]
  references: NoteReference[]
}
/** How literally a sketch is to be taken: to the millimetre, the shape and the place, or as a route with a diameter to keep clear. */
export type SketchTake = 'exact' | 'rough' | 'flow'
/** How a sketch's plane was made: a main plane, a planar face (its ref as of its build), a plane through a picked point, or a locked standard view. */
export type SketchPlaneFrom =
  | { kind: 'main'; axis: 'XY' | 'XZ' | 'YZ'; offset: number }
  | { kind: 'face'; ref: string; offset: number; revision: number }
  | { kind: 'point'; point: Vec3; normal: Vec3; offset: number }
  | { kind: 'view'; label: string }
/** An orthonormal frame in the object frame (the normal is x × y), numbered within its sketch. */
export interface SketchPlane {
  id: number
  origin: Vec3
  x: Vec3
  y: Vec3
  label: string
  from: SketchPlaneFrom
}
/**
 * Which point of a stroke snapped, and to what, as of the build the stroke is of: a vertex (`part/V12`), the centre of a
 * circular edge (`part/E14`, with its radius), or a point on an edge (`part/E40`; `approx` of one that is neither straight
 * nor circular, which only its ref says). `projected`: the point is that one put on the stroke's plane.
 */
export type SketchSnap = ({ i: number } & ({ vertex: string } | { centre: string; radius: number } | { edge: string; approx?: true })) & { projected?: true }
/** One stroke: on a plane of the sketch (`plane` is its id, with `points2d`) or on the surface (`points`). */
export interface SketchStroke {
  plane?: number
  points?: Vec3[]
  points2d?: [number, number][]
  pen: 'free' | 'line' | 'points'
  snaps?: SketchSnap[]
  /** Drawn with x-ray on, so that its picture shows it where parts hide it. */
  xray?: true
  /** The build it was drawn on: its snaps and what it touches are of that one. */
  revision: number
  /** The faces it lies on or crosses, as of `revision`. Main's alone: never taken from the window or a tool. */
  touches?: string[]
}
/**
 * A drawing in 3D: strokes on planes and on the surface, made to say where a part goes, how a hose runs, what to cut.
 * Its `picture` is the board card's, `k-<12 hex>.png` in `.torno/notes/`; main names it, and marks.json never holds the bytes.
 */
export interface SketchMark extends MarkBase {
  kind: 'sketch'
  name: string
  take: SketchTake
  /** mm; of a flow sketch only. */
  diameter?: number
  planes: SketchPlane[]
  strokes: SketchStroke[]
  /** The first point of the first stroke that lies on a face; none when it was drawn in empty space. */
  anchor?: Anchor
  picture?: string
}
export type Mark = PinMark | PickMark | ArrowMark | StrokeMark | ShapeMark | DimensionMark | RegionMark | NoteMark | SketchMark
export type MarkKind = Mark['kind']
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** What main alone says of a mark: no caller supplies these. */
export const MAIN_ONLY_KEYS = ['resolvedBy', 'acknowledged', 'sentBefore', 'reopened', 'checkedRevision'] as const
/** What main alone says of a dimension: what the kernel measured or why it could not, on which build, and the verdict. No caller supplies these either. */
export const MEASURED_KEYS = ['value', 'how', 'points', 'measuredRevision', 'refused', 'verdict'] as const
/** What the kernel's measurement leaves on a dimension (`MEASURED_KEYS`). */
export type Measurement = Pick<DimensionMark, (typeof MEASURED_KEYS)[number]>
type Given<M> = M extends DimensionMark ? Omit<M, (typeof MEASURED_KEYS)[number]> : M extends RegionMark ? Omit<M, (typeof REGION_KEYS)[number]> : M
/** What a caller supplies; main adds id, status, anchorState, createdAt, and what only it says. */
export type NewMark = DistributiveOmit<Given<Mark>, 'id' | 'status' | 'anchorState' | 'createdAt' | (typeof MAIN_ONLY_KEYS)[number]>
/** `acknowledged` may only be set, and only on a mark the agent resolved. */
export type MarkPatch = Partial<Pick<MarkBase, 'note' | 'status' | 'resolvedNote' | 'acknowledged'>> &
  Partial<Pick<ShapeMark, 'intent' | 'position' | 'rotation' | 'size' | 'shape'>> & {
    /** Of a dimension: what it should measure, and how far off it may be. Null takes the expectation away, or puts the tolerance back to its default. */
    expected?: number | null
    tolerance?: number | null
  }
/** A note as main gives it to `MarkStore.addNote`: its files are already written, and named by main. */
export type NewNote = Extract<NewMark, { kind: 'note' }>
/** What a person changes of a note; `ink` is the file of the picture with the new ink on it. */
export type NotePatch = Partial<Pick<NoteMark, 'note' | 'labels' | 'strokes' | 'under' | 'references' | 'ink'>>
export interface MarksFile { next: number; marks: Mark[] }
/**
 * What the window gives to keep a region: the scan, and its triangles as the bits of a mask (bit `i & 7` of
 * byte `i >> 3` for triangle `i`). Main works out everything else from the mesh, and writes the mask.
 */
export interface NewRegion { scan: string; note: string; layout: string; revision: number; camera: Camera; bits: Uint8Array }
/** Where a mark is put again, by a click on a part: the anchor found there, on which build and from which view. */
export interface Replacement { anchor: Anchor; revision: number; camera: Camera }

/** The least a side, a diameter or a height of a shape can be, in millimetres: main holds a size to it, and the gizmo and the fields stop there. */
export const MIN_SHAPE_SIZE = 0.1

/** The most points a stroke keeps. Main cuts a longer one there; whoever draws one sends no more. */
export const MAX_STROKE_POINTS = 400

/** The anchors a mark carries: where it is tied to the geometry. A shape placed in empty space has none. */
export function markAnchors(mark: Mark): Anchor[] {
  switch (mark.kind) {
    case 'pin':
    case 'pick':
    case 'stroke':
      return [mark.anchor]
    case 'arrow':
      return [mark.from]
    case 'shape':
    case 'note':
    case 'sketch':
      return mark.anchor ? [mark.anchor] : []
    case 'dimension':
      return mark.b ? [mark.a, mark.b] : [mark.a]
    case 'region':
      // It is on a scan, not on a part: nothing of a build is under it.
      return []
  }
}

/** The most points of a surface stroke that are checked against a build, besides its first. */
export const STROKE_SAMPLES = 8

/**
 * Points of a surface stroke after its first, evenly spaced along its list and
 * ending with its last: at most `most`. The first is the stroke's anchor, and
 * is checked as such. None for any other mark: a profile on a plane lies on
 * nothing.
 */
export function strokeSamples(mark: Mark, most = STROKE_SAMPLES): Vec3[] {
  if (mark.kind === 'sketch') return sketchSamples(mark, most)
  if (mark.kind !== 'stroke' || mark.space !== 'surface') return []
  const rest = (mark.points ?? []).slice(1)
  return evenly(rest, most)
}

/** At most `most` of `points`, evenly spaced along the list and ending with its last. */
const evenly = (points: Vec3[], most: number): Vec3[] => (points.length <= most ? points : Array.from({ length: most }, (_, i) => points[Math.round(((i + 1) * points.length) / most) - 1]))

/** The most strokes of a sketch that are checked against a build. */
const SKETCH_STROKES_CHECKED = 8

/**
 * Of a sketch: the same for each stroke on the surface, at most 8 strokes (evenly along them, the first and the last
 * kept). The sketch's anchor is the first point of its first stroke on a face, and is checked as the anchor: that point
 * is not among the samples. A stroke on a plane lies on nothing and is not judged, nor is a point snapped to a hole's centre.
 */
function sketchSamples(mark: SketchMark, most: number): Vec3[] {
  const surface = mark.strokes.filter((stroke) => stroke.plane === undefined && (stroke.points?.length ?? 0) > 0)
  const chosen =
    surface.length <= SKETCH_STROKES_CHECKED
      ? surface
      : Array.from({ length: SKETCH_STROKES_CHECKED }, (_, i) => surface[Math.round((i * (surface.length - 1)) / (SKETCH_STROKES_CHECKED - 1))])
  const anchor = mark.anchor?.point
  return chosen.flatMap((stroke, n) => {
    const all = stroke.points ?? []
    // A point snapped to a circle's centre sits in the air, not on a face: it is never a sample.
    const air = new Set((stroke.snaps ?? []).filter((snap) => 'centre' in snap).map((snap) => snap.i))
    const points = all.filter((_, i) => !air.has(i))
    // Only the first stroke on the surface can hold the anchor, as its first point.
    const first = n === 0 && anchor !== undefined && points.length > 0 && points[0].every((c, i) => c === anchor[i])
    return first ? evenly(points.slice(1), most) : evenly(points, most)
  })
}

/**
 * Whether nothing has checked an open mark against the build there is: its
 * ref and descriptor are then of an older build, or of whoever placed it.
 * `revision` is that of the last build that worked; with none, nothing is unchecked.
 */
export function isUnchecked(mark: Mark, revision: number | undefined): boolean {
  // A region is of a scan: no build has anything to say of it.
  return mark.kind !== 'region' && mark.status !== 'resolved' && revision !== undefined && revision > 0 && mark.checkedRevision !== revision
}

/** A mark the agent resolved and the person has not yet said they have seen: it stays among the open ones in the panel. */
export function awaitsAcknowledgement(mark: Mark): boolean {
  return mark.status === 'resolved' && mark.resolvedBy === 'agent' && mark.acknowledged !== true
}

const moved = (p: Vec3, by: Vec3): Vec3 => [p[0] + by[0], p[1] + by[1], p[2] + by[2]]

/**
 * A mark with everything it holds in the frame of its layout moved by `by`:
 * its anchor's point, an arrow's end, the points of a stroke on the surface,
 * the origin of a stroke's plane, a shape's position, both ends of a
 * dimension and the points its value was taken between. Used when the part it
 * is on is spread otherwise than it was (`Anchor.arranged`). The second end
 * of a dimension, and the point its value was taken at there, move by `byB`:
 * it may be on another part, which was moved otherwise.
 */
export function translated<M extends Mark>(mark: M, by: Vec3, byB: Vec3 = by): M {
  const at = (anchor: Anchor): Anchor => ({ ...anchor, point: moved(anchor.point, by) })
  const m: Mark = mark
  switch (m.kind) {
    case 'pin':
    case 'pick':
      return { ...m, anchor: at(m.anchor) } as M
    case 'arrow':
      return { ...m, from: at(m.from), to: moved(m.to, by) } as M
    case 'stroke':
      return {
        ...m,
        anchor: at(m.anchor),
        ...(m.points ? { points: m.points.map((p) => moved(p, by)) } : {}),
        ...(m.plane ? { plane: { ...m.plane, origin: moved(m.plane.origin, by) } } : {})
      } as M
    case 'shape':
      return { ...m, position: moved(m.position, by), ...(m.anchor ? { anchor: at(m.anchor) } : {}) } as M
    case 'dimension':
      // Of one end alone (a radius, a wall) both points are of that end.
      return { ...m, a: at(m.a), ...(m.b ? { b: { ...m.b, point: moved(m.b.point, byB) } } : {}), ...(m.points ? { points: [moved(m.points[0], by), moved(m.points[1], m.b ? byB : by)] } : {}) } as M
    case 'note':
      // Its picture is of a view, and the ink is in pixels of it: only where it is tied to the model moves.
      return m.anchor ? ({ ...m, anchor: at(m.anchor) } as M) : mark
    case 'sketch':
      return {
        ...m,
        planes: m.planes.map((plane) => ({ ...plane, origin: moved(plane.origin, by), from: plane.from.kind === 'point' ? { ...plane.from, point: moved(plane.from.point, by) } : plane.from })),
        // The points of a stroke on a plane are in mm of its plane's axes, and move with the plane.
        strokes: m.strokes.map((stroke) => (stroke.points ? { ...stroke, points: stroke.points.map((p) => moved(p, by)) } : stroke)),
        ...(m.anchor ? { anchor: at(m.anchor) } : {})
      } as M
    case 'region':
      // What it holds is in its scan's frame, and a scan is never spread.
      return mark
  }
}

/**
 * The points of a stroke in the object frame: its own on a surface, or those
 * of its plane, `origin + x·u + y·v`.
 */
export function strokePoints(mark: StrokeMark): Vec3[] {
  if (mark.space === 'surface') return mark.points ?? []
  const plane = mark.plane
  if (!plane) return []
  return (mark.points2d ?? []).map(([u, v]) => plane.origin.map((o, i) => o + plane.x[i] * u + plane.y[i] * v) as Vec3)
}

/** The points of a stroke of a sketch in the object frame: its own on the surface, or those of its plane, `origin + x·u + y·v`; none for a plane the sketch lacks. */
export function sketchStrokePoints(mark: Pick<SketchMark, 'planes'>, stroke: SketchStroke): Vec3[] {
  if (stroke.plane === undefined) return stroke.points ?? []
  const plane = mark.planes.find((p) => p.id === stroke.plane)
  if (!plane) return []
  return (stroke.points2d ?? []).map(([u, v]) => [plane.origin[0] + plane.x[0] * u + plane.y[0] * v, plane.origin[1] + plane.x[1] * u + plane.y[1] * v, plane.origin[2] + plane.x[2] * u + plane.y[2] * v])
}

/** A vector turned by a rotation; one that is no rotation at all (all zeros) turns nothing. */
function turned(v: Vec3, rotation: Quat): Vec3 {
  const length = Math.hypot(...rotation)
  if (!(length > 0)) return v
  const [x, y, z, w] = rotation.map((c) => c / length)
  const [tx, ty, tz] = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]
}

/** Points that bound what is drawn of a mark, in the object frame: what the camera's clip planes must keep in. */
export function markPoints(mark: Mark): Vec3[] {
  switch (mark.kind) {
    case 'pin':
    case 'pick':
      return [mark.anchor.point]
    case 'arrow':
      return [mark.from.point, mark.to]
    case 'stroke':
      return [mark.anchor.point, ...strokePoints(mark)]
    case 'shape': {
      const half = mark.size.map((s) => s / 2)
      const corners: Vec3[] = []
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(moved(turned([sx * half[0], sy * half[1], sz * half[2]], mark.rotation), mark.position))
      return corners
    }
    case 'dimension':
      return [mark.a.point, ...(mark.b ? [mark.b.point] : []), ...(mark.points ?? [])]
    case 'sketch':
      return mark.strokes.flatMap((stroke) => sketchStrokePoints(mark, stroke))
    case 'note':
      // It is a picture, drawn in no view: nothing of it needs the camera to keep it in.
      return []
    case 'region':
      // It is drawn on its scan, which is inside what the camera keeps in already.
      return []
  }
}

/** How many sides a circle of a shape's outline is drawn with. */
const OUTLINE_SIDES = 48

/**
 * The outline of a shape as lines through points of the object frame, each a polyline (a closed one ends where
 * it began): a box by its two rectangles and four uprights, a plane by its rectangle, a cylinder by its two
 * circles and four uprights, a sphere by three great circles. Plain arithmetic, for whoever draws a shape
 * without the viewport: an exported page.
 */
export function shapeOutline(mark: Pick<ShapeMark, 'shape' | 'size' | 'position' | 'rotation'>): Vec3[][] {
  const [hx, hy, hz] = mark.size.map((s) => s / 2)
  const at = (local: Vec3): Vec3 => moved(turned(local, mark.rotation), mark.position)
  const rectangle = (z: number): Vec3[] => ([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]] as const).map(([x, y]) => at([x, y, z]))
  const circle = (point: (cos: number, sin: number) => Vec3): Vec3[] => Array.from({ length: OUTLINE_SIDES + 1 }, (_, n) => {
    const angle = ((n % OUTLINE_SIDES) / OUTLINE_SIDES) * 2 * Math.PI
    return at(point(Math.cos(angle), Math.sin(angle)))
  })
  switch (mark.shape) {
    case 'plane':
      return [rectangle(0)]
    case 'box':
      return [rectangle(-hz), rectangle(hz), ...([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const).map(([x, y]) => [at([x, y, -hz]), at([x, y, hz])])]
    case 'cylinder':
      return [circle((c, s) => [hx * c, hy * s, -hz]), circle((c, s) => [hx * c, hy * s, hz]), ...([[hx, 0], [0, hy], [-hx, 0], [0, -hy]] as const).map(([x, y]) => [at([x, y, -hz]), at([x, y, hz])])]
    case 'sphere':
      return [circle((c, s) => [hx * c, hy * s, 0]), circle((c, s) => [hx * c, 0, hz * s]), circle((c, s) => [0, hy * c, hz * s])]
  }
}

/** How far outside a part's box a point may lie and still be at that part, in millimetres. */
const AT_PART_MM = 0.5

/**
 * The part each end of a mark is at, undefined for an end on none: one end for most marks; two for a dimension
 * between two ends, and for an arrow whose head is at another part than its foot (`boxes`, by part name, the
 * parts' boxes as built, say which: its own when the head is at that one, else the first other part whose box
 * holds it; in the open it goes whole with what it starts on). None for a mark tied to nothing. It is what says
 * how a mark is drawn while its parts are drawn apart: in the window, and in an exported page.
 */
export function markEndParts(mark: Mark, boxes: Readonly<Record<string, { min: Vec3; max: Vec3 }>> = {}): Array<string | undefined> {
  if (mark.kind === 'dimension') return markAnchors(mark).map((anchor) => anchor.part)
  if (mark.kind === 'arrow') {
    const own = mark.from.part
    const within = (box: { min: Vec3; max: Vec3 }): boolean => mark.to.every((c, i) => c >= box.min[i] - AT_PART_MM && c <= box.max[i] + AT_PART_MM)
    const head = own !== undefined && boxes[own] && within(boxes[own]) ? own : Object.keys(boxes).find((name) => name !== own && within(boxes[name]))
    return head === undefined || head === own ? [own] : [own, head]
  }
  return markAnchors(mark).slice(0, 1).map((anchor) => anchor.part)
}
