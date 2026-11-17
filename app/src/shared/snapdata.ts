// What the kernel sends of a part's B-rep for snapping, part-local like the mesh (`PartMesh.points`, `.circles`).
// Straight edges have no entry: their ends are two vertices, which main finds in `points`.

import { bufView, type Part } from './scene'

type Vec3 = [number, number, number]

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
