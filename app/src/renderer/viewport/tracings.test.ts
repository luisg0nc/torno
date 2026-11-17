import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { planeOfFrom, type Layer, type Tracing, type TracingCut } from '../../shared/tracings'
import { LIGHT_THEME } from './theme'
import { TracingLayer, tracingsSaid } from './tracings'

const layer = (over: Partial<Layer> = {}): Layer => ({
  id: 1,
  name: 'Hinge marks',
  colour: 'ochre',
  by: 'agent',
  shapes: [{ kind: 'polyline', points: [[10, 10], [20, 10], [20, 20]] }, { kind: 'circle', centre: [30, 30], radius: 4 }, { kind: 'label', at: [5, 5], text: 'a' }],
  revision: 1,
  ...over
})
// 400 × 300 px at 4 px/mm, its top left at (0, 75) mm: the photo covers u 0 to 100 and v 0 to 75.
const photo = { file: 'p-0123456789ab.jpg', sha256: 'a'.repeat(64), width: 400, height: 300, pairs: [], method: 'similar' as const, transform: [0.25, 0, 0, 0, -0.25, 75, 0, 0, 1] as never, scale: 4, angle: 0, straightened: 's-0123456789ab.png', fade: 0.5 }
const tracing = (over: Partial<Tracing> = {}): Tracing => ({ id: 'T1', by: 'person', name: 'Front of the block', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: planeOfFrom({ kind: 'main', axis: 'XZ', offset: 0 })!, layers: [layer()], nextLayer: 2, ...over })
const cut = (id = 'T1'): TracingCut => ({
  tracing: id,
  revision: 3,
  cut: {
    plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] },
    parts: [{ part: 'tub', loops: [{ points: [[0, 0], [40, 0], [40, 30], [0, 30]], closed: true, area: 1200, areaExact: true, deflection: 0 }], area: 1200, areaExact: true, open: 0, how: 'cross-section of the solid' }],
    bounds: { min: [0, 0], max: [40, 30] }
  },
  snaps: []
})
const bitmap = { width: 400, height: 300, close: () => {} } as unknown as ImageBitmap

const named = (layerOf: TracingLayer, tracingId: string, name: string): THREE.Object3D | undefined => layerOf.group.getObjectByName(tracingId)?.getObjectByName(name)
const meshOf = (o: THREE.Object3D | undefined): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> => o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
const linesOf = (o: THREE.Object3D | undefined): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> => o as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
const positions = (o: THREE.Mesh | THREE.LineSegments): THREE.Vector3[] => {
  const at = o.geometry.getAttribute('position')
  return Array.from({ length: at.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(at, i))
}
const hex = (c: THREE.Color): string => `#${c.getHexString()}`

describe('the photo of a tracing in 3D', () => {
  it('is a quad in the tracing’s plane (y = 0 for XZ), of the photo’s rectangle, with depth writing off', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ photo }), cut: cut(), photo: bitmap }])
    const quad = meshOf(named(layerOf, 'T1', 'photo'))
    expect(quad).toBeDefined()
    const corners = positions(quad)
    expect(corners.every((p) => Math.abs(p.y) < 1e-9)).toBe(true)
    expect(Math.min(...corners.map((p) => p.x))).toBeCloseTo(0)
    expect(Math.max(...corners.map((p) => p.x))).toBeCloseTo(100)
    expect(Math.min(...corners.map((p) => p.z))).toBeCloseTo(0)
    expect(Math.max(...corners.map((p) => p.z))).toBeCloseTo(75)
    expect(quad.material.depthWrite).toBe(false)
    expect(quad.material.transparent).toBe(true)
    expect(quad.material.map?.image).toBe(bitmap)
  })

  it('is at the photo’s fade times 0.6, and follows the fade without a new picture', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ photo }), cut: cut(), photo: bitmap }])
    const first = meshOf(named(layerOf, 'T1', 'photo'))
    expect(first.material.opacity).toBeCloseTo(0.3)
    const texture = first.material.map
    layerOf.set([{ tracing: tracing({ photo: { ...photo, fade: 1 } }), cut: cut(), photo: bitmap }])
    const next = meshOf(named(layerOf, 'T1', 'photo'))
    expect(next.material.opacity).toBeCloseTo(0.6)
    expect(next.material.map).toBe(texture)
  })

  it('has its top row at the greatest v, as the straightened copy has it', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ photo }), cut: cut(), photo: bitmap }])
    const quad = meshOf(named(layerOf, 'T1', 'photo'))
    const at = quad.geometry.getAttribute('uv')
    const points = positions(quad)
    for (let i = 0; i < points.length; i++) {
      // The texture is not flipped on upload, so the image's first row is the texture's t = 0.
      expect(at.getY(i)).toBeCloseTo(points[i].z > 37 ? 0 : 1)
      expect(at.getX(i)).toBeCloseTo(points[i].x > 50 ? 1 : 0)
    }
    expect(quad.material.map?.flipY).toBe(false)
  })

  it('is not drawn for a photo that is hidden, or one that has no picture here', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ photo: { ...photo, hidden: true } }), cut: cut(), photo: bitmap }])
    expect(named(layerOf, 'T1', 'photo')).toBeUndefined()
    layerOf.set([{ tracing: tracing({ photo }), cut: cut() }])
    expect(named(layerOf, 'T1', 'photo')).toBeUndefined()
    layerOf.set([{ tracing: tracing({ photo: { ...photo, transform: undefined } }), cut: cut(), photo: bitmap }])
    expect(named(layerOf, 'T1', 'photo')).toBeUndefined()
  })
})

describe('the outline and the layers of a tracing in 3D', () => {
  it('draw the outline in the ink colour and each visible layer in its own, in the plane, with depth writing off', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ layers: [layer(), layer({ id: 2, name: 'Mine', colour: 'blue', by: 'person', hidden: true })] }), cut: cut() }])
    const outline = linesOf(named(layerOf, 'T1', 'outline'))
    expect(hex(outline.material.color)).toBe(LIGHT_THEME.ink.toLowerCase())
    // Four edges of the closed loop, as segments in pairs.
    expect(positions(outline)).toHaveLength(8)
    expect(positions(outline).every((p) => Math.abs(p.y) < 1e-9)).toBe(true)
    expect(outline.material.depthWrite).toBe(false)
    const drawn = linesOf(named(layerOf, 'T1', 'layer 1'))
    expect(hex(drawn.material.color)).toBe(LIGHT_THEME.layers.ochre.toLowerCase())
    expect(drawn.material.depthWrite).toBe(false)
    expect(positions(drawn).every((p) => Math.abs(p.y) < 1e-9)).toBe(true)
    // The circle is a ring of segments around its centre, at its radius.
    const ring = positions(drawn).filter((p) => Math.hypot(p.x - 30, p.z - 30) < 5)
    expect(ring.length).toBeGreaterThan(16)
    expect(ring.every((p) => Math.abs(Math.hypot(p.x - 30, p.z - 30) - 4) < 1e-4)).toBe(true)
    expect(named(layerOf, 'T1', 'layer 2')).toBeUndefined()
  })

  it('draws the outline of a tracing with no cut yet as nothing, and the layers all the same', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing() }])
    expect(named(layerOf, 'T1', 'outline')).toBeUndefined()
    expect(named(layerOf, 'T1', 'layer 1')).toBeDefined()
  })

  it('moves with the plane of the tracing', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    const moved = tracing({ plane: planeOfFrom({ kind: 'main', axis: 'XZ', offset: 12 })! })
    layerOf.set([{ tracing: moved, cut: cut() }])
    expect(positions(linesOf(named(layerOf, 'T1', 'outline'))).every((p) => Math.abs(p.y - 12) < 1e-9)).toBe(true)
  })

  it('takes its colours again from a theme that changed', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing(), cut: cut() }])
    layerOf.setLook({ ...LIGHT_THEME, ink: '#ffffff', layers: { ...LIGHT_THEME.layers, ochre: '#010203' } })
    expect(hex(linesOf(named(layerOf, 'T1', 'outline')).material.color)).toBe('#ffffff')
    expect(hex(linesOf(named(layerOf, 'T1', 'layer 1')).material.color)).toBe('#010203')
  })
})

describe('where a tracing is drawn', () => {
  it('is never cut by a section: no material of it takes a clipping plane', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ photo }), cut: cut(), photo: bitmap }])
    const materials: THREE.Material[] = []
    layerOf.group.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (m) materials.push(...(Array.isArray(m) ? m : [m]))
    })
    expect(materials.length).toBeGreaterThan(3)
    for (const m of materials) {
      expect(m.clippingPlanes ?? null).toBeNull()
      expect(m.depthWrite).toBe(false)
    }
    // The layer is not given the planes of a section, as the parts and the scans are.
    expect('setClipping' in layerOf).toBe(false)
  })

  it('is drawn in the layout of its tracing only', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing(), cut: cut() }, { tracing: tracing({ id: 'T2', layout: 'print' }), cut: cut('T2') }])
    layerOf.show('assembly')
    expect(layerOf.drawn('assembly')).toEqual(['T1'])
    expect(layerOf.drawn('print')).toEqual(['T2'])
    expect(layerOf.group.getObjectByName('T1')?.visible).toBe(true)
    expect(layerOf.group.getObjectByName('T2')?.visible).toBe(false)
    layerOf.show('print')
    expect(layerOf.group.getObjectByName('T1')?.visible).toBe(false)
    expect(layerOf.group.getObjectByName('T2')?.visible).toBe(true)
    layerOf.show(null)
    expect(layerOf.group.children.some((c) => c.visible)).toBe(false)
  })

  it('lets go of a tracing that is no longer shown, and keeps the others as they were', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing(), cut: cut() }, { tracing: tracing({ id: 'T2' }), cut: cut('T2') }])
    const kept = layerOf.group.getObjectByName('T2')
    layerOf.set([{ tracing: tracing({ id: 'T2' }), cut: cut('T2') }])
    expect(layerOf.group.getObjectByName('T1')).toBeUndefined()
    expect(layerOf.group.getObjectByName('T2')).toBe(kept)
    layerOf.dispose()
    expect(layerOf.group.children).toHaveLength(0)
  })

  it('is sized to the outline’s bounds and the photo’s rectangle, and a margin', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ photo }), cut: cut(), photo: bitmap }])
    const sphere = layerOf.extend(new THREE.Sphere(new THREE.Vector3(), 0), 'assembly')
    // The photo (100 × 75) is the larger: the sheet is that and a margin round it, in the plane y = 0.
    const sheet = positions(meshOf(named(layerOf, 'T1', 'sheet')))
    expect(Math.min(...sheet.map((p) => p.x))).toBeLessThan(0)
    expect(Math.max(...sheet.map((p) => p.x))).toBeGreaterThan(100)
    expect(Math.min(...sheet.map((p) => p.z))).toBeLessThan(0)
    expect(Math.max(...sheet.map((p) => p.z))).toBeGreaterThan(75)
    expect(sheet.every((p) => Math.abs(p.y) < 1e-9)).toBe(true)
    for (const p of sheet) expect(sphere.distanceToPoint(p)).toBeLessThan(1e-6)
    // Another layout's tracing does not reach the frame.
    expect(layerOf.extend(new THREE.Sphere(new THREE.Vector3(), 0), 'print').radius).toBe(0)
  })

  it('says which tracings it draws, and whether each has its photo, for the tests and the caption', () => {
    const layerOf = new TracingLayer(LIGHT_THEME)
    layerOf.set([{ tracing: tracing({ photo }), cut: cut(), photo: bitmap }, { tracing: tracing({ id: 'T2' }) }])
    expect(layerOf.state()).toEqual([
      { id: 'T1', layout: 'assembly', outline: true, photo: true, layers: 1 },
      { id: 'T2', layout: 'assembly', outline: false, photo: false, layers: 1 }
    ])
  })
})

describe('what a look says of the tracings it draws', () => {
  it('names one, or several, and nothing for none', () => {
    expect(tracingsSaid([])).toBe('')
    expect(tracingsSaid(['T1'])).toBe(' · tracing T1 shown in its plane')
    expect(tracingsSaid(['T1', 'T3'])).toBe(' · tracings T1, T3 shown in their planes')
  })
})
