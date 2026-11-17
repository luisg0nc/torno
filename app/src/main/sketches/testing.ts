// What the tests of the sketches build: a scene whose parts carry snap data, the blob it points into, and the build
// the checks are given. The part `block` stands in the object frame turned a quarter about Z and moved, so that a check
// that forgot the part's `loc` would be wrong by a lot. `old` has no snap data, as a part of an older kernel.

import type { Vec3 } from '../../shared/marks'
import { rotate } from '../../shared/align'
import { type Buf, type Part, type Scene } from '../../shared/scene'
import { snapOf, type SnapData } from '../../shared/snapdata'

export const LOC = { t: [100, 50, 0] as Vec3, q: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number] }

/** A point of `block`'s own frame, in the object frame. */
export const world = (p: Vec3): Vec3 => {
  const r = rotate(LOC.q, p)
  return [r[0] + LOC.t[0], r[1] + LOC.t[1], r[2] + LOC.t[2]]
}

/** The ten vertices of `block`, part-local, V0 to V9. */
export const VERTICES: Vec3[] = [
  [0, 0, 0], [40, 0, 0], [40, 30, 0], [0, 30, 0],
  [0, 0, 20], [40, 0, 20], [40, 30, 20], [0, 30, 20],
  [5, 5, 0], [35, 25, 0]
]
/** Edge 14 is a circle of this centre and radius, in the plane z = 5, part-local. */
export const CIRCLE = { centre: [10, 20, 5] as Vec3, radius: 8 }
/** Edge 0 runs from V0 to V1, edge 4 is a B-spline from V4 to V5. */
export const EDGE_COUNT = 15

export interface Fixture {
  scene: Scene
  blob: ArrayBuffer
  build: { revision: number; scene: Scene; blob: ArrayBuffer; snap: (part: string) => SnapData | undefined }
}

export function fixture(revision = 7): Fixture {
  // Every buffer goes in a blob of its own bytes, one after another.
  const chunks: Array<{ at: number; data: ArrayBufferView }> = []
  let size = 0
  const put = (data: Float32Array | Uint32Array): Buf => {
    const buf = { offset: size, length: data.byteLength }
    chunks.push({ at: size, data })
    size += data.byteLength
    return buf
  }

  const segments: number[] = []
  const types: number[] = []
  const edges: number[] = []
  const line = (a: Vec3, b: Vec3, type = 0): void => {
    segments.push(1)
    types.push(type)
    edges.push(...a, ...b)
  }
  const [v0, v1, v2, v3, v4, v5] = VERTICES
  line(v0, v1)
  line(v1, v2)
  line(v2, v3)
  line(v3, v0)
  segments.push(2)
  types.push(6)
  edges.push(...v4, 20, 0, 25, 20, 0, 25, ...v5)
  for (let i = 5; i < 14; i++) line([i * 2, 10, 0], [i * 2, 10, 5])
  segments.push(8)
  types.push(1)
  const ring = (k: number): Vec3 => [CIRCLE.centre[0] + CIRCLE.radius * Math.cos((k * Math.PI) / 4), CIRCLE.centre[1] + CIRCLE.radius * Math.sin((k * Math.PI) / 4), CIRCLE.centre[2]]
  for (let k = 0; k < 8; k++) edges.push(...ring(k), ...ring(k + 1))

  const none = put(new Float32Array(0))
  const mesh = {
    vertices: none,
    normals: none,
    triangles: put(new Uint32Array(0)),
    edges: put(new Float32Array(edges)),
    trianglesPerFace: put(new Uint32Array(0)),
    segmentsPerEdge: put(new Uint32Array(segments)),
    faceTypes: put(new Uint32Array(0)),
    edgeTypes: put(new Uint32Array(types)),
    points: put(new Float32Array(VERTICES.flat())),
    circles: put(new Float32Array([14, ...CIRCLE.centre, 0, 0, 1, CIRCLE.radius]))
  }
  const blob = new ArrayBuffer(size)
  for (const { at, data } of chunks) new Uint8Array(blob, at, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))

  const corners = VERTICES.slice(0, 8).map(world)
  const box = { min: [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i]))) as Vec3, max: [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i]))) as Vec3 }
  const block = { key: 'assembly:block', name: 'block', layout: 'assembly', loc: LOC, bbox: box, edgeCount: EDGE_COUNT, mesh } as unknown as Part
  const old = {
    key: 'assembly:old',
    name: 'old',
    layout: 'assembly',
    loc: { t: [0, 0, 0], q: [0, 0, 0, 1] },
    bbox: { min: [0, 0, 0], max: [10, 10, 10] },
    edgeCount: 0,
    mesh: { ...mesh, points: undefined, circles: undefined }
  } as unknown as Part
  const scene = { model: 'm.py', layouts: ['assembly'], parts: [block, old], seconds: 0, output: '' } as unknown as Scene
  return { scene, blob, build: { revision, scene, blob, snap: (name) => { const part = scene.parts.find((p) => p.layout === 'assembly' && p.name === name); return part ? snapOf(part, blob) : undefined } } }
}
