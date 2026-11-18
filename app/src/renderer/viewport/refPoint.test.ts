import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { BuiltPart } from './partMesh'
import { refPoint } from './refPoint'

// A square face of two triangles, and an edge of two segments of unequal length.
function built(): BuiltPart {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry())
  const square = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(square, 3))
  mesh.geometry.setIndex([0, 1, 2, 0, 2, 3])
  const edges = new THREE.LineSegments(new THREE.BufferGeometry())
  edges.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 4, 0, 0, 6, 0, 0], 3))
  const group = new THREE.Group()
  group.position.set(100, 0, 0)
  return { group, mesh, edges, faceted: false, solid: true, faceStarts: new Uint32Array([0, 6]), edgeStarts: new Uint32Array([0, 2]) } as unknown as BuiltPart
}

describe('a point on what a ref names, for the leader to end in', () => {
  const part = built()
  const of = (name: string) => (name === 'lid' ? part : undefined)

  it('is the middle of the triangle of a face that is nearest the middle of its box, where the part is drawn', () => {
    const [x, y, z] = refPoint(of, 'lid/F0')!
    // The box's middle is (105, 5, 0): the two triangles are as near, the first wins.
    expect([x, y, z].map((v) => Math.round(v * 1000) / 1000)).toEqual([106.667, 3.333, 0])
  })

  it('is the middle of the segment of an edge nearest the middle of its box, and the middle of the whole part for its name', () => {
    expect(refPoint(of, 'lid/E0')).toEqual([102, 0, 0])
    expect(refPoint(of, 'lid')).toEqual([105, 5, 0])
  })

  it('is null for what is not drawn', () => {
    expect(refPoint(of, 'gone/F0')).toBeNull()
    expect(refPoint(of, 'lid/F9')).toBeNull()
  })
})
