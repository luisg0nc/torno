import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Buf, Part } from '../../shared/scene'
import { Highlights, MARK_LAYERS } from './highlight'
import { buildPart, type BuiltPart } from './partMesh'

/** A square of two faces (two triangles each) and one edge, as the kernel would pack it. */
function square(): BuiltPart {
  const arrays: Record<string, Float32Array | Uint32Array> = {
    vertices: new Float32Array([0, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5, 0, 10, 10, 0, 0, 10, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3, 3, 2, 4, 3, 4, 5]),
    edges: new Float32Array([0, 0, 0, 10, 0, 0]),
    trianglesPerFace: new Uint32Array([2, 2]),
    segmentsPerEdge: new Uint32Array([1]),
    faceTypes: new Uint32Array(2),
    edgeTypes: new Uint32Array(1)
  }
  const blob = new ArrayBuffer(Object.values(arrays).reduce((n, a) => n + a.byteLength, 0))
  const mesh: Record<string, Buf> = {}
  let offset = 0
  for (const [name, a] of Object.entries(arrays)) {
    new Uint8Array(blob).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offset)
    mesh[name] = { offset, length: a.byteLength }
    offset += a.byteLength
  }
  const part: Part = {
    key: 'assembly:plate',
    name: 'plate',
    layout: 'assembly',
    loc: { t: [0, 0, 0], q: [0, 0, 0, 1] },
    bbox: { min: [0, 0, 0], max: [10, 10, 0] },
    volume: 0,
    faceCount: 2,
    edgeCount: 1,
    triangleCount: 4,
    valid: true,
    hash: 'plate',
    mesh: mesh as unknown as Part['mesh']
  }
  return buildPart(part, blob)
}

/** What is drawn over the part itself: all but its own surface and edges. */
const overlays = (built: BuiltPart): THREE.Object3D[] => built.group.children.filter((c) => c !== built.mesh && c !== built.edges)
const shown = (built: BuiltPart): THREE.Object3D[] => overlays(built).filter((c) => c.visible)
const colourOf = (object: THREE.Object3D): string => {
  const material = (object as THREE.Mesh).material
  return `#${((Array.isArray(material) ? material[0] : material) as THREE.MeshBasicMaterial).color.getHexString()}`
}

describe('Highlights', () => {
  const COLOURS = { accent: '#1d46b8', agent: '#2b8a5c', user: '#cf3f2c' }

  it('tints the faces of what the person does not want in their colour, hatched, and no other layer is', () => {
    const built = square()
    const highlights = new Highlights()
    highlights.setColors(COLOURS)
    highlights.set('userDont', ['plate/F1'])
    highlights.set('userMark', ['plate/F0'])
    highlights.apply((name) => (name === 'plate' ? built : undefined))
    const drawn = shown(built)
    expect(drawn.map(colourOf)).toEqual([COLOURS.user, COLOURS.user])
    const materials = drawn.map((d) => (d as THREE.Mesh).material as THREE.MeshBasicMaterial[])
    const hatchedOnes = drawn.filter((_, i) => materials[i][0].userData.hatched === true)
    expect(hatchedOnes).toHaveLength(1)
    expect((hatchedOnes[0] as THREE.Mesh).geometry.groups).toEqual([{ start: 6, count: 6, materialIndex: 0 }])
  })

  it('tints a face for a selection and for a pick mark at once: both are drawn, the selection over the mark', () => {
    const built = square()
    const highlights = new Highlights()
    highlights.setColors(COLOURS)
    const partNamed = (name: string) => (name === 'plate' ? built : undefined)
    highlights.set('selection', ['plate/F1'])
    highlights.set('userMark', ['plate/F1'])
    highlights.apply(partNamed)

    const drawn = shown(built)
    expect(drawn.map(colourOf).sort()).toEqual([COLOURS.accent, COLOURS.user].sort())
    const [mark, selection] = [drawn.find((d) => colourOf(d) === COLOURS.user)!, drawn.find((d) => colourOf(d) === COLOURS.accent)!]
    expect(selection.renderOrder).toBeGreaterThan(mark.renderOrder)
    for (const d of drawn) expect((d as THREE.Mesh).geometry.groups).toEqual([{ start: 6, count: 6, materialIndex: 0 }])

    // Taking the selection away leaves the mark's tint.
    highlights.set('selection', [])
    highlights.apply(partNamed, 'selection')
    expect(shown(built).map(colourOf)).toEqual([COLOURS.user])
  })

  it('lights what is pointed at in the accent, over a pick mark of the person\'s, and never in the agent\'s colour', () => {
    const built = square()
    const highlights = new Highlights()
    highlights.setColors(COLOURS)
    const partNamed = (name: string) => (name === 'plate' ? built : undefined)
    highlights.set('userMark', ['plate/F1'])
    highlights.set('point', ['plate/F1', 'plate/E0'])
    highlights.apply(partNamed)
    const drawn = shown(built)
    const pointedAt = drawn.filter((d) => colourOf(d) === COLOURS.accent)
    // The face and the edge, both in the accent: the person's red stays under it, and no green is drawn.
    expect(pointedAt).toHaveLength(2)
    expect(drawn.map(colourOf)).not.toContain(COLOURS.agent)
    expect(drawn.map(colourOf)).toContain(COLOURS.user)
    const mark = drawn.find((d) => colourOf(d) === COLOURS.user)!
    for (const d of pointedAt) expect(d.renderOrder).toBeGreaterThan(mark.renderOrder)
    expect(highlights.refsOf('point')).toEqual(['plate/F1', 'plate/E0'])
    // What the agent points at keeps its own colour.
    highlights.set('agent', ['plate/F0'])
    highlights.apply(partNamed, 'agent')
    expect(shown(built).map(colourOf)).toContain(COLOURS.agent)
  })

  it('a ref that names nothing in the scene tints nothing, and does not throw', () => {
    const built = square()
    const highlights = new Highlights()
    highlights.setColors(COLOURS)
    highlights.set('agentMark', ['plate/F9', 'plate/E7', 'gone', 'gone/F0', ''])
    expect(() => highlights.apply((name) => (name === 'plate' ? built : undefined))).not.toThrow()
    expect(shown(built)).toEqual([])
  })

  it('hides everything for a picture of the parts alone, and all but the marks for one with them', () => {
    const built = square()
    const highlights = new Highlights()
    highlights.setColors(COLOURS)
    const partNamed = () => built
    highlights.set('selection', ['plate/F0'])
    highlights.set('hover', ['plate/E0'])
    highlights.set('agentMark', ['plate/F1'])
    highlights.set('userMark', ['plate/E0'])
    highlights.apply(partNamed)
    expect(shown(built)).toHaveLength(4)

    highlights.setVisible(false)
    expect(shown(built)).toEqual([])
    highlights.setVisible(true, MARK_LAYERS)
    expect(shown(built).map(colourOf).sort()).toEqual([COLOURS.agent, COLOURS.user].sort())
    // What is applied while a layer is hidden stays hidden.
    highlights.apply(partNamed)
    expect(shown(built)).toHaveLength(2)
    highlights.setVisible(true)
    expect(shown(built)).toHaveLength(4)
  })

  it('frees what it drew on a part that is going', () => {
    const built = square()
    const highlights = new Highlights()
    highlights.set('userMark', ['plate/F0'])
    highlights.set('selection', ['plate/F0'])
    highlights.apply(() => built)
    let freed = 0
    for (const overlay of overlays(built)) (overlay as THREE.Mesh).geometry.addEventListener('dispose', () => (freed += 1))
    highlights.forget(built)
    expect(overlays(built)).toEqual([])
    expect(freed).toBe(2)
  })
})

describe('a part that a section leaves nothing of', () => {
  it('has nothing tinted or thickened on it while that lasts, whatever is highlighted meanwhile', () => {
    const built = square()
    const highlights = new Highlights()
    const partNamed = (name: string) => (name === 'plate' ? built : undefined)
    const drawn = () => built.group.children.filter((child) => child !== built.mesh && child !== built.edges).map((child) => child.visible)
    highlights.set('selection', ['plate/F0', 'plate/E0'])
    highlights.apply(partNamed)
    expect(drawn()).toEqual([true, true])

    highlights.suppress(built, true)
    expect(drawn()).toEqual([false, false])
    highlights.set('hover', ['plate/F1'])
    highlights.set('selection', ['plate/F1', 'plate/E0'])
    highlights.apply(partNamed)
    expect(drawn().some(Boolean)).toBe(false)
    highlights.setVisible(false)
    highlights.setVisible(true)
    expect(drawn().some(Boolean)).toBe(false)

    highlights.suppress(built, false)
    expect(drawn().filter(Boolean)).toHaveLength(3) // the selection's face and edge, and the hover
  })
})
