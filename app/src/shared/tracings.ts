import { rotate } from './align'
import type { Sectioned } from './geometry'
import type { Vec3 } from './marks'
import { type MainAxis, mainPlaneFrame } from './planes'
import type { Part } from './scene'
import { type SnapData, vertexAt } from './snapdata'

// Tracings: the model laid flat in one plane at true scale, with a photo under it and layers over it. The pure rules both
// sides use are here: what a tracing is, its caps, and the maths between a tracing's own [u, v] (`uv`, millimetres) and the
// object frame. Main keeps them (`main/tracings/store.ts`, `.torno/tracings.json`) and is their only writer.

/** A tracing's id: `T1`, `T2`, … given by main only and never given again. */
export const TRACING_ID = /^T[1-9]\d{0,14}$/

/** How a tracing's plane came to be. A main plane is `planeOfFrom` here; a face's and a section's frames are main's, from the kernel. */
export type TracingFrom =
  | { kind: 'main'; axis: MainAxis; offset: number }
  | { kind: 'face'; ref: string; tag?: string; revision: number }
  | { kind: 'section'; origin: Vec3; normal: Vec3 }

/** An orthonormal frame in the object frame of the tracing's layout (the normal is `x × y`), and how it was made. */
export interface TracingPlane {
  origin: Vec3
  x: Vec3
  y: Vec3
  label: string
  from: TracingFrom
}

/** The colours a layer takes from (`--layer-*`). Red and green are the person's and Claude's, so they are not among them. */
export const LAYER_COLOURS = ['blue', 'teal', 'violet', 'ochre', 'plum', 'slate', 'sky', 'olive'] as const
export type LayerColour = (typeof LAYER_COLOURS)[number]

export type LayerShape =
  | { name?: string; kind: 'polyline'; points: [number, number][]; closed?: true }
  | { name?: string; kind: 'circle'; centre: [number, number]; radius: number }
  | { kind: 'label'; at: [number, number]; text: string }

export interface Layer {
  /** Within the tracing, given by main only and never given again. */
  id: number
  name: string
  colour: LayerColour
  by: 'person' | 'agent'
  hidden?: true
  shapes: LayerShape[]
  /** Counts the times the layer's shapes, name or colour were changed, from 1. */
  revision: number
}

/** A point of the photo (pixels of the kept file) and the point of the tracing (`uv`, mm) it is lined up with, and what the point was snapped to. */
export interface LineupPair {
  photo: [number, number]
  uv: [number, number]
  snap?: { corner: string } | { centre: string } | { vertex: string }
}

/** A 3 × 3 matrix by rows: from pixels of the photo to `uv` in mm. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number]

export interface TracingPhoto {
  /** `p-<12 hex>.jpg|png` in `.torno/tracings/photos/`. */
  file: string
  sha256: string
  width: number
  height: number
  caption?: string
  /** The reference it was taken from, `reference/photo-2.jpg`. */
  from?: string
  pairs: LineupPair[]
  method: 'similar' | 'straight'
  transform?: Matrix3
  /** Pixels per mm at the tracing's centre. */
  scale?: number
  /** Degrees the photo was turned. */
  angle?: number
  /** The root mean square of the residuals in mm, only when there are more pairs than the method needs. */
  fit?: number
  /** The name of the warped copy, `s-<12 hex>.jpg|png`. */
  straightened?: string
  /** 0 to 1. */
  fade: number
  hidden?: true
}

export interface Tracing {
  id: string
  by: 'person' | 'agent'
  /** One line; empty is `Tracing T3` (`tracingName`). */
  name: string
  layout: string
  createdAt: string
  /** The build it was made on. In memory only: build numbers restart every run, so the file carries none and a read drops it. */
  revision?: number
  /** That build's history id and its `sources` hash. */
  build?: { id: string; sources: string }
  plane: TracingPlane
  /** The parts drawn, by name; absent means every part of the layout. */
  parts?: string[]
  layers: Layer[]
  /** The number the next layer is given: past every id this tracing has had. */
  nextLayer: number
  photo?: TracingPhoto
  /** The sentence of a face that is no longer in the plane (`block/F31 is not in this plane any more`). Main's. */
  lost?: string
}

export interface TracingsFile {
  /** The number the next tracing is given: past every `T<n>` the file has held. */
  next: number
  tracings: Tracing[]
}

export const MOST_TRACINGS = 50
export const MOST_LAYERS = 20
/** Shapes in one layer. */
export const MOST_SHAPES = 500
/** Points of polylines in one tracing, all its layers together. */
export const MOST_TRACING_POINTS = 20_000
export const MAX_TRACING_NAME = 80
export const MAX_LAYER_NAME = 60
/** The longest name of a shape, and the longest text of a label, in characters. */
export const MAX_SHAPE_NAME = 80
export const MAX_LABEL_TEXT = 200

/** What only main says of a tracing: never taken from the window or from a tool's arguments. */
export const TRACING_MAIN_ONLY = ['id', 'by', 'nextLayer', 'lost'] as const
/** What only main says of a tracing's photo. */
export const PHOTO_MAIN_ONLY = ['file', 'sha256', 'width', 'height', 'transform', 'scale', 'angle', 'fit', 'straightened'] as const

/** The name a tracing is shown by: its own, or `Tracing T3` when it has none. */
export const tracingName = (t: Pick<Tracing, 'id' | 'name'>): string => (t.name === '' ? `Tracing ${t.id}` : t.name)

/** How far the axes of a plane may be from a frame (unit length, at right angles). */
const FRAME_WITHIN = 1e-6

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Whether two axes are finite, of unit length and at right angles, each within 1e-6. */
export function validFrame(x: Vec3, y: Vec3): boolean {
  if (!x.every(Number.isFinite) || !y.every(Number.isFinite)) return false
  return Math.abs(Math.hypot(...x) - 1) <= FRAME_WITHIN && Math.abs(Math.hypot(...y) - 1) <= FRAME_WITHIN && Math.abs(dot(x, y)) <= FRAME_WITHIN
}

/** The point of the object frame that `uv` of the tracing is. */
export function toObject(plane: Pick<TracingPlane, 'origin' | 'x' | 'y'>, uv: readonly [number, number]): Vec3 {
  const { origin: o, x, y } = plane
  return [o[0] + uv[0] * x[0] + uv[1] * y[0], o[1] + uv[0] * x[1] + uv[1] * y[1], o[2] + uv[0] * x[2] + uv[1] * y[2]]
}

/** The `uv` of a point of the object frame, along the plane's axes. The distance from the plane is dropped. */
export function toUv(plane: Pick<TracingPlane, 'origin' | 'x' | 'y'>, p: Vec3): [number, number] {
  const d: Vec3 = [p[0] - plane.origin[0], p[1] - plane.origin[1], p[2] - plane.origin[2]]
  return [dot(d, plane.x), dot(d, plane.y)]
}

/** Whether a point lies in the plane, within `within` mm of it. */
export function inPlane(plane: Pick<TracingPlane, 'origin' | 'x' | 'y'>, p: Vec3, within = 1e-6): boolean {
  const n = cross(plane.x, plane.y)
  const d: Vec3 = [p[0] - plane.origin[0], p[1] - plane.origin[1], p[2] - plane.origin[2]]
  return Math.abs(dot(d, n)) <= within
}

/**
 * The plane of a main origin, through `mainPlaneFrame` (the one rule for main planes, its label included). Null for a face
 * and a section: their frames are main's, because they need the kernel.
 */
export function planeOfFrom(from: TracingFrom): TracingPlane | null {
  if (from.kind !== 'main') return null
  return { ...mainPlaneFrame(from.axis, from.offset), from }
}

/** How many shapes a tracing holds, in all its layers. */
export const shapeCount = (t: Pick<Tracing, 'layers'>): number => t.layers.reduce((sum, l) => sum + l.shapes.length, 0)

/** How many points the polylines of a tracing hold, in all its layers. */
export const pointCount = (t: Pick<Tracing, 'layers'>): number => t.layers.reduce((sum, l) => sum + l.shapes.reduce((n, s) => n + (s.kind === 'polyline' ? s.points.length : 0), 0), 0)

/**
 * What a tracing can be snapped to, in its own `[u, v]`: the corners of the cut and the centres of its circles (the kernel's,
 * exact, from the B-rep: `SectionLoop.corners` and `.circles`), and the vertices of the parts (the build's snap data). A vertex
 * further than `PLAIN_WITHIN` from the plane is offered too, as `projected`: where it lands on the plane, not a point of it.
 */
export type PlaneSnap =
  | { kind: 'corner'; uv: [number, number]; part: string }
  | { kind: 'centre'; uv: [number, number]; radius: number; part: string; edge?: string }
  | { kind: 'vertex'; uv: [number, number]; part: string; ref: string; projected?: true }

/** A tracing's outline of one build, as main tells the window: the kernel's cut with the points it can be snapped to. */
export interface TracingCut {
  tracing: string
  /** The build it was cut on (this run's build number). */
  revision: number
  cut: Sectioned
  snaps: PlaneSnap[]
}

/** How far from the plane a vertex is to lie in it, mm. */
export const PLAIN_WITHIN = 0.01
/** The most vertices offered as snaps for one tracing: those nearest the plane. A part of many thousands would make each outline a megabyte. */
export const MOST_PLANE_VERTICES = 5000

/**
 * The points a tracing can be snapped to: the corners and circle centres of `cut`, then the vertices of `parts` (each with its
 * snap data, part-local, turned by `Part.loc` into the object frame) projected onto the plane, plain within `PLAIN_WITHIN` of it
 * and `projected` beyond, those nearest the plane first and at most `MOST_PLANE_VERTICES`. The one rule for main (the line-up
 * and span checks) and the window (the Trace tool, the line-up).
 */
export function planeSnaps(plane: Pick<TracingPlane, 'origin' | 'x' | 'y'>, parts: ReadonlyArray<{ part: Part; snap?: SnapData }>, cut: Sectioned): PlaneSnap[] {
  const snaps: PlaneSnap[] = []
  for (const of of cut.parts) {
    for (const loop of of.loops) {
      for (const uv of loop.corners ?? []) snaps.push({ kind: 'corner', uv: [uv[0], uv[1]], part: of.part })
      for (const c of loop.circles ?? []) snaps.push({ kind: 'centre', uv: [c.centre[0], c.centre[1]], radius: c.radius, part: of.part, ...(c.edge === undefined ? {} : { edge: c.edge }) })
    }
  }
  const normal = cross(plane.x, plane.y)
  const vertices: Array<{ away: number; snap: PlaneSnap }> = []
  for (const { part, snap } of parts) {
    if (!snap) continue
    for (let i = 0; 3 * i + 3 <= snap.points.length; i++) {
      const local = vertexAt(snap, i)
      if (!local) continue
      const turned = rotate(part.loc.q, local)
      const p: Vec3 = [turned[0] + part.loc.t[0], turned[1] + part.loc.t[1], turned[2] + part.loc.t[2]]
      const away = Math.abs(dot([p[0] - plane.origin[0], p[1] - plane.origin[1], p[2] - plane.origin[2]], normal))
      vertices.push({ away, snap: { kind: 'vertex', uv: toUv(plane, p), part: part.name, ref: `${part.name}/V${i}`, ...(away > PLAIN_WITHIN ? { projected: true as const } : {}) } })
    }
  }
  vertices.sort((a, b) => a.away - b.away)
  for (const { snap } of vertices.slice(0, MOST_PLANE_VERTICES)) snaps.push(snap)
  return snaps
}
