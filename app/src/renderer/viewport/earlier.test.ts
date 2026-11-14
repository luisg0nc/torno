import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Buf, Part } from '../../shared/scene'
import { EARLIER_EDGE_OPACITY, EARLIER_SURFACE_OPACITY, Earlier } from './earlier'

/** A blob with one quad and one edge, packed the way the kernel does. */
function pack(): { blob: ArrayBuffer; mesh: Part['mesh'] } {
  const arrays: Record<string, Float32Array | Uint32Array> = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
    edges: new Float32Array([0, 0, 0, 1, 0, 0]),
    trianglesPerFace: new Uint32Array([2]),
    segmentsPerEdge: new Uint32Array([1]),
    faceTypes: new Uint32Array([0]),
    edgeTypes: new Uint32Array([0])
  }
  const total = Object.values(arrays).reduce((n, a) => n + a.byteLength, 0)
  const blob = new ArrayBuffer(total)
  const bufs: Record<string, Buf> = {}
  let offset = 0
  for (const [name, a] of Object.entries(arrays)) {
    new Uint8Array(blob).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offset)
    bufs[name] = { offset, length: a.byteLength }
    offset += a.byteLength
  }
  return { blob, mesh: bufs as unknown as Part['mesh'] }
}

const part = (name: string, mesh: Part['mesh']): Part =>
  ({ key: `assembly:${name}`, name, layout: 'assembly', loc: { t: [1, 2, 3], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [1, 1, 0] }, volume: 1, faceCount: 1, edgeCount: 1, triangleCount: 2, valid: true, hash: name, mesh }) as Part

describe('Earlier', () => {
  it('draws the parts of an earlier build translucent and tinted, where that build had them, and nothing picks them', () => {
    const { blob, mesh } = pack()
    const earlier = new Earlier()
    expect(earlier.on).toBe(false)
    earlier.show([part('tub', mesh), part('lid', mesh)], blob, '#646970')
    expect(earlier.on).toBe(true)
    expect(earlier.keys()).toEqual(['assembly:tub', 'assembly:lid'])
    const group = earlier.group.children[0] as THREE.Group
    expect(group.position.toArray()).toEqual([1, 2, 3])
    const [surface, lines] = group.children as [THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>]
    expect(surface.material.transparent).toBe(true)
    expect(surface.material.opacity).toBe(EARLIER_SURFACE_OPACITY)
    expect(surface.material.depthWrite).toBe(false)
    expect(lines.material.opacity).toBe(EARLIER_EDGE_OPACITY)
    expect(surface.material.color.getHexString()).toBe('646970')
    // Never pointed at: no bounds tree, and a ray finds nothing.
    expect(surface.geometry.boundsTree).toBeUndefined()
    const hits: THREE.Intersection[] = []
    surface.raycast(new THREE.Raycaster(new THREE.Vector3(0.5, 0.5, 10), new THREE.Vector3(0, 0, -1)), hits)
    expect(hits).toEqual([])
  })

  it('is put away whole, by a new set and by clear, and is hidden for a picture and back', () => {
    const { blob, mesh } = pack()
    const earlier = new Earlier()
    earlier.show([part('tub', mesh)], blob, '#646970')
    earlier.show([part('lid', mesh)], blob, '#646970')
    expect(earlier.keys()).toEqual(['assembly:lid'])
    expect(earlier.group.children).toHaveLength(1)
    const back = earlier.hide()
    expect(earlier.group.visible).toBe(false)
    back()
    expect(earlier.group.visible).toBe(true)
    expect(earlier.clear()).toBe(true)
    expect(earlier.clear()).toBe(false)
    expect(earlier.group.children).toHaveLength(0)
  })

  it('takes the colour of the theme again', () => {
    const { blob, mesh } = pack()
    const earlier = new Earlier()
    earlier.show([part('tub', mesh)], blob, '#646970')
    earlier.tint('#A0A4AA')
    const surface = (earlier.group.children[0] as THREE.Group).children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    expect(surface.material.color.getHexString()).toBe('a0a4aa')
  })

  it('is drawn solid, with edges in ink, when it is shown alone (Before, Side by side), and translucent again after', () => {
    const { blob, mesh } = pack()
    const earlier = new Earlier()
    earlier.show([part('tub', mesh)], blob, '#646970')
    earlier.tint('#646970', '#22252A')
    earlier.solid(true)
    const [surface, lines] = (earlier.group.children[0] as THREE.Group).children as [THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>]
    expect([surface.material.transparent, surface.material.opacity, surface.material.depthWrite]).toEqual([false, 1, true])
    expect([lines.material.opacity, lines.material.color.getHexString()]).toEqual([1, '22252a'])
    // A new set of parts is drawn as it is now.
    earlier.show([part('lid', mesh)], blob, '#646970')
    const [again] = (earlier.group.children[0] as THREE.Group).children as [THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>]
    expect(again.material.opacity).toBe(1)
    earlier.solid(false)
    const [back, edges] = (earlier.group.children[0] as THREE.Group).children as [THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>]
    expect([back.material.transparent, back.material.opacity, back.material.depthWrite]).toEqual([true, EARLIER_SURFACE_OPACITY, false])
    expect([edges.material.opacity, edges.material.color.getHexString()]).toEqual([EARLIER_EDGE_OPACITY, '646970'])
  })
})
