// What the kernel sends of a part's B-rep for snapping, part-local like the mesh (`PartMesh.points`, `.circles`).
// Straight edges have no entry: their ends are two vertices, which main finds in `points`.

import { bufView, type Part } from './scene'

type Vec3 = [number, number, number]

// The kernel's curve types of an edge (OCCT's `GeomAbs_CurveType`, `PartMesh.edgeTypes`): the two whose points can be
// worked out exactly, a point on a straight edge and on a circle.
export const EDGE_LINE = 0
export const EDGE_CIRCLE = 1

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** How far along the segment from `a` to `b` the point nearest to `p` is, from 0 to 1. */
export function segmentParameter(a: Vec3, b: Vec3, p: Vec3): number {
  const d = sub(b, a)
  const length2 = dot(d, d)
  return length2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / length2))
}

/** The point of the segment from `a` to `b` nearest to `p`: how a point on a straight edge is told, between the edge's two vertices. */
export function nearestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  return add(a, times(sub(b, a), segmentParameter(a, b, p)))
}

/** Any unit vector at a right angle to `axis`. */
export function orthogonal(axis: Vec3): Vec3 {
  const least = Math.abs(axis[0]) <= Math.abs(axis[1]) && Math.abs(axis[0]) <= Math.abs(axis[2]) ? ([1, 0, 0] as Vec3) : Math.abs(axis[1]) <= Math.abs(axis[2]) ? ([0, 1, 0] as Vec3) : ([0, 0, 1] as Vec3)
  const c = cross(axis, least)
  return times(c, 1 / Math.hypot(...c))
}

/** The point of a circle (centre, unit axis, radius) nearest to `p`; over the centre every point is as near, and any one is told. */
export function nearestOnCircle(centre: Vec3, axis: Vec3, radius: number, p: Vec3): Vec3 {
  const v = sub(p, centre)
  const flat = sub(v, times(axis, dot(v, axis)))
  const length = Math.hypot(...flat)
  const direction: Vec3 = length > 1e-12 ? times(flat, 1 / length) : orthogonal(axis)
  return add(centre, times(direction, radius))
}

export interface SnapData {
  /** Float32 xyz of every B-rep vertex, in the order `V<i>` names them (`i` from 0). */
  points: Float32Array
  /** Float32, eight to a circular edge, whole or an arc: `edge` (its `E<i>` index), centre xyz, axis xyz, radius. */
  circles: Float32Array
}

const CIRCLE = 8

/** The vertex `V<i>`, or null when there is none. */
export function vertexAt(data: SnapData, i: number): Vec3 | null {
  if (!Number.isInteger(i) || i < 0 || 3 * i + 3 > data.points.length) return null
  const p = data.points
  return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
}

/** The circle that edge `E<edge>` is, or null when it is not one. */
export function circleOf(data: SnapData, edge: number): { centre: Vec3; axis: Vec3; radius: number } | null {
  const c = data.circles
  for (let k = 0; k + CIRCLE <= c.length; k += CIRCLE) {
    if (c[k] === edge) return { centre: [c[k + 1], c[k + 2], c[k + 3]], axis: [c[k + 4], c[k + 5], c[k + 6]], radius: c[k + 7] }
  }
  return null
}

/** A part's snap data out of the scene's blob, copied so the blob can be released; undefined of a part whose kernel sent none. */
export function snapOf(part: Part, blob: ArrayBuffer): SnapData | undefined {
  const { points, circles } = part.mesh
  if (!points || !circles) return undefined
  return { points: bufView(blob, points, Float32Array).slice(), circles: bufView(blob, circles, Float32Array).slice() }
}
