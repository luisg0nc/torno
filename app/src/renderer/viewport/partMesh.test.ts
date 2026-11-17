import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Buf, Part } from '../../shared/scene'
import { buildPart, faceOfTriangle, isFaceted } from './partMesh'

/** Packs typed arrays into one blob, the way the kernel does. */
function pack(arrays: Record<string, Float32Array | Uint32Array>): { blob: ArrayBuffer; bufs: Record<string, Buf> } {
  const total = Object.values(arrays).reduce((n, a) => n + a.byteLength, 0)
  const blob = new ArrayBuffer(total)
  const bytes = new Uint8Array(blob)
  const bufs: Record<string, Buf> = {}
  let offset = 0
  for (const [name, a] of Object.entries(arrays)) {
    bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offset)
    bufs[name] = { offset, length: a.byteLength }
    offset += a.byteLength
  }
  return { blob, bufs }
}

// Two faces: a quad (2 triangles) and a hexagon-ish fan (4 triangles), 10 vertices.
const vertices = new Float32Array(30).map((_, i) => i * 0.5)
const normals = new Float32Array(30).map((_, i) => (i % 3 === 2 ? 1 : 0))
const triangles = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 4, 7, 8, 4, 8, 9])
const edges = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1e-7]) // last one degenerate
const { blob, bufs } = pack({
  vertices,
  normals,
  triangles,
  edges,
  trianglesPerFace: new Uint32Array([2, 4]),
  segmentsPerEdge: new Uint32Array([1, 1, 1]),
  faceTypes: new Uint32Array([0, 0]),
  edgeTypes: new Uint32Array([0, 0, 0])
})

const s = Math.SQRT1_2
const part: Part = {
  key: 'assembly:base',
  name: 'base',
  layout: 'assembly',
  loc: { t: [-20, -15, -2.5], q: [0, 0, s, s] }, // 90° about Z
  bbox: { min: [-20, -15, -2.5], max: [20, 15, 2.5] },
  volume: 6000,
  faceCount: 2,
  edgeCount: 3,
  triangleCount: 6,
  valid: true,
  hash: 'abc',
  mesh: bufs as unknown as Part['mesh']
}

describe('buildPart', () => {
  const built = buildPart(part, blob)

  it('makes faceStarts the running index offset with a leading 0', () => {
    expect(Array.from(built.faceStarts)).toEqual([0, 6, 18])
  })

  it('makes edgeStarts the running segment count with a leading 0', () => {
    expect(Array.from(built.edgeStarts)).toEqual([0, 1, 2, 3])
  })

  it('has a bounds tree for picking, and leaves the triangles in the order faceStarts counts in', () => {
    expect(built.mesh.geometry.boundsTree).toBeDefined()
    expect(Array.from(built.mesh.geometry.getIndex()!.array)).toEqual(Array.from(triangles))
  })

  it('gives the geometry the right vertex and index counts', () => {
    const g = built.mesh.geometry
    expect(g.getAttribute('position').count).toBe(10)
    expect(g.getAttribute('normal').count).toBe(10)
    expect(g.getIndex()?.count).toBe(18)
    expect(Array.from(g.getIndex()!.array)).toEqual(Array.from(triangles))
    expect(Array.from(g.getAttribute('position').array)).toEqual(Array.from(vertices))
  })

  it('draws every edge segment, degenerate ones included', () => {
    expect(built.edges.geometry.getAttribute('position').count).toBe(6)
  })

  it('puts mesh and edges under a group that carries loc', () => {
    expect(built.mesh.parent).toBe(built.group)
    expect(built.edges.parent).toBe(built.group)
    expect(built.group.position.toArray()).toEqual([-20, -15, -2.5])
    expect(built.group.quaternion.toArray()).toEqual([0, 0, s, s])
    expect(built.mesh.position.toArray()).toEqual([0, 0, 0])
  })

  it('uses the standard material the look calls for', () => {
    const m = built.mesh.material
    expect(m.roughness).toBe(0.75)
    expect(m.metalness).toBe(0)
    expect(m.flatShading).toBe(false)
    expect(m.polygonOffset).toBe(true)
    expect(m.polygonOffsetFactor).toBeGreaterThan(0)
  })

  it('owns its data, so the blob can be released', () => {
    const copy = blob.slice(0)
    const b = buildPart(part, copy)
    new Uint8Array(copy).fill(0)
    expect(Array.from(b.mesh.geometry.getAttribute('position').array)).toEqual(Array.from(vertices))
    expect(Array.from(b.faceStarts)).toEqual([0, 6, 18])
  })
})

describe('buildPart, snap data', () => {
  it('decodes the vertices and the circles the kernel sent, and owns them', () => {
    const points = new Float32Array([0, 0, 0, 1, 2, 3])
    const circles = new Float32Array([4, 10, 10, 0, 0, 0, 1, 4])
    const packed = pack({ vertices, normals, triangles, edges, trianglesPerFace: new Uint32Array([2, 4]), segmentsPerEdge: new Uint32Array([1, 1, 1]), faceTypes: new Uint32Array([0, 0]), edgeTypes: new Uint32Array([0, 0, 0]), points, circles })
    const snapped = buildPart({ ...part, mesh: packed.bufs as unknown as Part['mesh'] }, packed.blob)
    new Uint8Array(packed.blob).fill(0)
    expect(Array.from(snapped.snap!.points)).toEqual(Array.from(points))
    expect(Array.from(snapped.snap!.circles)).toEqual(Array.from(circles))
  })

  it('leaves them undefined when the kernel sent none', () => {
    expect(buildPart(part, blob).snap).toBeUndefined()
  })
})

describe('isFaceted', () => {
  const faces = (count: number, triangles: (i: number) => number) => Uint32Array.from({ length: count }, (_, i) => triangles(i))

  it('is true for a solid made of a mesh: a thousand faces or more, nearly all of one or two triangles', () => {
    expect(isFaceted(faces(1000, () => 1))).toBe(true)
    expect(isFaceted(faces(5000, (i) => (i % 2) + 1))).toBe(true)
    // Exactly nine in ten.
    expect(isFaceted(faces(1000, (i) => (i < 900 ? 2 : 40)))).toBe(true)
  })

  it('is false for a part with fewer than a thousand faces, whatever they are', () => {
    expect(isFaceted(faces(999, () => 1))).toBe(false)
    expect(isFaceted(new Uint32Array([2, 2, 2, 2, 2, 2]))).toBe(false) // a box
    expect(isFaceted(new Uint32Array(0))).toBe(false)
  })

  it('is false for a part with many faces that are real surfaces', () => {
    expect(isFaceted(faces(1000, (i) => (i < 899 ? 2 : 40)))).toBe(false)
    expect(isFaceted(faces(4000, () => 3))).toBe(false)
  })
})

/**
 * A sheet of 50 × 10 squares, folded square along its middle, as a sewn STL
 * arrives: every triangle a face of its own with its own three vertices, and
 * every triangle's outline among the B-rep edges.
 */
function foldedSheet(): { part: Part; blob: ArrayBuffer } {
  const at = (i: number, j: number): [number, number, number] => (i <= 25 ? [i, j, 0] : [25, j, i - 25])
  const positions: number[] = []
  const lines: number[] = []
  for (let i = 0; i < 50; i++) {
    for (let j = 0; j < 10; j++) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
      for (const triangle of [[a, b, c], [a, c, d]]) {
        positions.push(...triangle.flat())
        for (let k = 0; k < 3; k++) lines.push(...triangle[k], ...triangle[(k + 1) % 3])
      }
    }
  }
  const count = positions.length / 9
  const packed = pack({
    vertices: new Float32Array(positions),
    normals: new Float32Array(positions.length).map((_, i) => (i % 3 === 2 ? 1 : 0)),
    triangles: Uint32Array.from({ length: count * 3 }, (_, i) => i),
    edges: new Float32Array(lines),
    trianglesPerFace: new Uint32Array(count).fill(1),
    segmentsPerEdge: new Uint32Array(count * 3).fill(1),
    faceTypes: new Uint32Array(count),
    edgeTypes: new Uint32Array(count * 3)
  })
  return {
    blob: packed.blob,
    part: { ...part, key: 'main:sheet', name: 'sheet', faceCount: count, edgeCount: count * 3, triangleCount: count, mesh: packed.bufs as unknown as Part['mesh'] }
  }
}

describe('buildPart, for a part made of a mesh', () => {
  const sheet = foldedSheet()
  const built = buildPart(sheet.part, sheet.blob)
  const drawn = built.edges.geometry.getAttribute('position')

  it('knows it for one, and an ordinary part for none', () => {
    expect(sheet.part.faceCount).toBe(1000)
    expect(built.faceted).toBe(true)
    expect(buildPart(part, blob).faceted).toBe(false)
  })

  it('draws its creases and its rim, not the outline of every triangle', () => {
    // The kernel sent 3000 segments. The rim is 2 × (50 + 10) long, the fold 10.
    expect(drawn.count).toBe(2 * (120 + 10))
    const onFold = (k: number) => drawn.getX(k) === 25 && drawn.getZ(k) === 0
    let fold = 0
    for (let k = 0; k < drawn.count; k += 2) if (onFold(k) && onFold(k + 1) && drawn.getY(k) !== drawn.getY(k + 1)) fold += 1
    expect(fold).toBe(10)
  })

  it('takes them from the surface, with a crease at 25° or more', () => {
    const creases = new THREE.EdgesGeometry(built.mesh.geometry, 25).getAttribute('position')
    expect(Array.from(drawn.array)).toEqual(Array.from(creases.array))
  })

  it('has no edges to pick: its lines are creases', () => {
    expect(Array.from(built.edgeStarts)).toEqual([0])
  })

  it('still places and parents the edges as for any part', () => {
    expect(built.edges.parent).toBe(built.group)
    expect(Array.from(built.faceStarts.slice(0, 3))).toEqual([0, 3, 6])
  })
})

describe('faceOfTriangle', () => {
  const faceStarts = new Uint32Array([0, 6, 18])

  it('maps triangles 0–1 to face 0 and 2–5 to face 1', () => {
    expect([0, 1, 2, 3, 4, 5].map((t) => faceOfTriangle(faceStarts, t))).toEqual([0, 0, 1, 1, 1, 1])
  })

  it('returns -1 outside the mesh', () => {
    expect(faceOfTriangle(faceStarts, 6)).toBe(-1)
    expect(faceOfTriangle(faceStarts, -1)).toBe(-1)
  })

  it('skips faces with no triangles', () => {
    const starts = new Uint32Array([0, 3, 3, 3, 9]) // faces 1 and 2 are empty
    expect([0, 1, 2].map((t) => faceOfTriangle(starts, t))).toEqual([0, 3, 3])
  })

  it('agrees with a linear scan on a larger mesh', () => {
    const counts = [3, 1, 7, 2, 2, 9, 1, 4]
    const starts = new Uint32Array(counts.length + 1)
    counts.forEach((c, i) => (starts[i + 1] = starts[i] + c * 3))
    let t = 0
    counts.forEach((c, face) => {
      for (let k = 0; k < c; k++) expect(faceOfTriangle(starts, t++)).toBe(face)
    })
  })
})
