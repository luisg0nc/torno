import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ScanInfo } from '../../shared/scans'
import { grid, meshBin } from '../../test/scanFixtures'
import { TriangleSet } from './scanPaint'
import { ScanLayer } from './scans'
import { PAINT_OPACITY, REGION_OPACITY } from './scanTints'
import { LIGHT_THEME } from './theme'

// What is laid over a scan: the regions kept and the set being painted, in a layer with no graphics card behind it.

const scan = (id: string, at = '2026-10-10T09:00:00.000Z', alignments: ScanInfo['alignments'] = {}): ScanInfo =>
  ({ id, name: id, source: { path: '', bytes: 0, mtimeMs: 0, sha256: '' }, imported: { unit: 'mm', up: 'z', assumed: { unit: false, up: false }, vertices: 900, triangles: 1682, colours: 'none', bbox: { min: [-14.5, -14.5, 0], max: [14.5, 14.5, 0] }, area: 841, at }, alignments, sourceState: 'present', meshState: 'ok', checks: {} }) as ScanInfo
const bitsOf = (...triangles: number[]): Uint8Array => {
  const set = new TriangleSet(1682)
  for (const t of triangles) set.add(t)
  return set.bits
}
/** A layer with one scan whose mesh has come; its tree is never made (nothing here points at it). */
function layer(): { layer: ScanLayer; redrawn: { count: number } } {
  const redrawn = { count: 0 }
  const made = new ScanLayer(() => (redrawn.count += 1), () => new Promise(() => {}))
  made.set([scan('S1')], 'assembly')
  made.load('S1', meshBin(grid(30)))
  return { layer: made, redrawn }
}
const tintsOf = (made: ScanLayer): THREE.Mesh[] => (made.built('S1')?.group.children ?? []).filter((child): child is THREE.Mesh => child.name === 'region')

describe('the regions kept', () => {
  it('are one mesh each over the scan’s own positions, in their authors’ colours, never in the scan’s materials', () => {
    const { layer: made } = layer()
    made.setLook({ plain: '#B4AFA5', surface: '#F1EFEA', marks: { user: '#b8336a', agent: '#1f7a5c' } }, false)
    made.tints.setRegions([
      { id: 'M1', scan: 'S1', author: 'user', bits: bitsOf(0, 1, 2) },
      { id: 'M2', scan: 'S1', author: 'agent', bits: bitsOf(9) }
    ])
    const built = made.built('S1')!
    const [user, agent] = tintsOf(made)
    expect(made.tints.state().regions).toEqual([
      { id: 'M1', scan: 'S1', triangles: 3, visible: true, colour: '#b8336a' },
      { id: 'M2', scan: 'S1', triangles: 1, visible: true, colour: '#1f7a5c' }
    ])
    expect(user.geometry.getAttribute('position')).toBe(built.mesh.geometry.getAttribute('position'))
    expect(user.geometry.index).not.toBe(built.mesh.geometry.index)
    expect([...user.geometry.index!.array]).toEqual([...built.mesh.geometry.index!.array.slice(0, 9)])
    const material = user.material as THREE.MeshBasicMaterial
    expect([material.opacity, material.transparent, material.depthWrite, material.polygonOffsetFactor]).toEqual([REGION_OPACITY, true, false, -1])
    expect(material).not.toBe(built.own)
    expect(material).not.toBe(built.plain)
    expect(agent.material).not.toBe(material)
    // The scan itself is what it was: still its one mesh, with its own material.
    expect(built.mesh.material).toBe(built.plain)
    // The colours follow the theme.
    made.setLook({ plain: '#B4AFA5', surface: '#17191C', marks: { user: '#e0709a', agent: '#4fb894' } }, false)
    expect(made.tints.state().regions.map((region) => region.colour)).toEqual(['#e0709a', '#4fb894'])
  })

  it('are hatched in their author\'s colour when the person does not want them, and plain again when they say otherwise', () => {
    const { layer: made } = layer()
    made.setLook({ plain: '#B4AFA5', surface: '#F1EFEA', marks: { user: '#b8336a', agent: '#1f7a5c' } }, false)
    made.tints.setRegions([{ id: 'M1', scan: 'S1', author: 'user', bits: bitsOf(0, 1), dont: true }, { id: 'M2', scan: 'S1', author: 'user', bits: bitsOf(3) }])
    const [dont, plain] = tintsOf(made).map((mesh) => mesh.material as THREE.MeshBasicMaterial)
    expect([dont.userData.hatched, plain.userData.hatched]).toEqual([true, undefined])
    expect(`#${dont.color.getHexString()}`).toBe('#b8336a')
    expect(made.tints.state().regions.map((region) => region.colour)).toEqual(['#b8336a', '#b8336a'])
    // Said again without the intent: the same bits are drawn plain.
    made.tints.setRegions([{ id: 'M1', scan: 'S1', author: 'user', bits: bitsOf(0, 1) }, { id: 'M2', scan: 'S1', author: 'user', bits: bitsOf(3) }])
    expect(tintsOf(made).map((mesh) => (mesh.material as THREE.MeshBasicMaterial).userData.hatched)).toEqual([undefined, undefined])
  })

  it('are in the mark colours of the light tokens until a theme is given: no colour of their own', () => {
    const { layer: made } = layer()
    made.tints.setRegions([
      { id: 'M1', scan: 'S1', author: 'user', bits: bitsOf(0) },
      { id: 'M2', scan: 'S1', author: 'agent', bits: bitsOf(9) }
    ])
    expect(made.tints.state().regions.map((region) => region.colour)).toEqual([LIGHT_THEME.user.toLowerCase(), LIGHT_THEME.agent.toLowerCase()])
  })

  it('are drawn in every layout, since they are of the scan wherever it stands, only while the scan is, and cut by the section with it', () => {
    const { layer: made } = layer()
    made.tints.setRegions([
      { id: 'M1', scan: 'S1', author: 'user', bits: bitsOf(0) },
      { id: 'M2', scan: 'S1', author: 'user', bits: bitsOf(1) }
    ])
    const shown = (): boolean[] => made.tints.state().regions.map((region) => region.visible)
    expect(shown()).toEqual([true, true])
    made.set([scan('S1')], 'print')
    expect(shown()).toEqual([true, true])
    // Switched off, the scan's group is not drawn, and neither is anything in it.
    made.setView('S1', { visible: false })
    expect(made.built('S1')!.group.visible).toBe(false)
    expect(tintsOf(made).every((tint) => tint.parent === made.built('S1')!.group)).toBe(true)
    const planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)]
    made.setClipping(planes)
    expect(tintsOf(made).map((tint) => (tint.material as THREE.Material).clippingPlanes)).toEqual([planes, planes])
  })

  it('are tinted in a picture unless it leaves the marks out, and are put back after', () => {
    const { layer: made } = layer()
    made.tints.setRegions([{ id: 'M1', scan: 'S1', author: 'user', bits: bitsOf(0) }])
    const set = new TriangleSet(1682)
    set.add(40)
    made.tints.paint('S1', set)
    const shown = (): boolean[] => made.tints.state().regions.map((region) => region.visible)
    const back = made.showOnly(['S1'], 'print')
    expect(shown()).toEqual([true])
    // What is being painted is no mark yet: it is in no picture.
    expect(made.tints.state().painting).toMatchObject({ visible: false })
    back()
    expect(made.tints.state().painting).toMatchObject({ visible: true })
    const without = made.showOnly(['S1'], 'assembly', false)
    expect(shown()).toEqual([false])
    without()
    expect(shown()).toEqual([true])
  })

  it('are not drawn from bits of another mesh, and go with the mesh they were drawn over', () => {
    const { layer: made } = layer()
    made.tints.setRegions([{ id: 'M1', scan: 'S1', author: 'user', bits: new Uint8Array(9) }, { id: 'M2', scan: 'S9', author: 'user', bits: bitsOf(1) }])
    expect(made.tints.state().regions).toEqual([])
    const bits = bitsOf(5)
    made.tints.setRegions([{ id: 'M1', scan: 'S1', author: 'user', bits }])
    expect(tintsOf(made)).toHaveLength(1)
    // The same regions told again: nothing is made anew.
    const [before] = tintsOf(made)
    made.tints.setRegions([{ id: 'M1', scan: 'S1', author: 'user', bits }])
    expect(tintsOf(made)[0]).toBe(before)
    // The scan read again is another mesh: its regions are drawn over the new one once it has come.
    made.set([scan('S1', '2026-10-11T09:00:00.000Z')], 'assembly')
    expect(made.tints.state().regions).toEqual([])
    made.load('S1', meshBin(grid(30)))
    expect(made.tints.state().regions).toHaveLength(1)
    expect(tintsOf(made)[0]).not.toBe(before)
    made.tints.setRegions([])
    expect(tintsOf(made)).toEqual([])
    made.dispose()
  })
})

describe('the set being painted', () => {
  it('is drawn as it changes, by writing only the stretches that changed', () => {
    const { layer: made, redrawn } = layer()
    const set = new TriangleSet(1682)
    const paint = made.tints.paint('S1', set)!
    const [tint] = tintsOf(made)
    const index = tint.geometry.index!
    expect(index.array).toHaveLength(1682 * 3)
    expect((tint.material as THREE.MeshBasicMaterial).opacity).toBe(PAINT_OPACITY)
    expect(tint.geometry.drawRange.count).toBe(0)
    const version = index.version
    const drawn = redrawn.count
    set.add(7)
    set.add(8)
    // Nothing is sent or drawn until the stroke says it touched the set.
    expect([index.version, redrawn.count]).toEqual([version, drawn])
    paint.touched()
    expect(index.updateRanges).toEqual([{ start: 0, count: 6 }])
    expect([index.version, redrawn.count, tint.geometry.drawRange.count]).toEqual([version + 1, drawn + 1, 6])
    expect(tint.geometry.index).toBe(index)
    // A touch with nothing changed sends nothing.
    index.clearUpdateRanges()
    paint.touched()
    expect([index.version, index.updateRanges]).toEqual([version + 1, []])
    set.delete(7)
    paint.touched()
    expect(index.updateRanges).toEqual([{ start: 0, count: 3 }])
    expect(tint.geometry.drawRange.count).toBe(3)
    expect(made.tints.state().painting).toEqual({ scan: 'S1', triangles: 1, visible: true })
  })

  it('takes up a set that already holds triangles, and is put away', () => {
    const { layer: made } = layer()
    const set = new TriangleSet(1682)
    for (let t = 0; t < 50; t++) set.add(t)
    made.tints.paint('S1', set)
    expect(made.tints.state().painting).toMatchObject({ triangles: 50 })
    expect(made.tints.paint(null, null)).toBeNull()
    expect(made.tints.state().painting).toBeNull()
    expect(tintsOf(made)).toEqual([])
    expect(set.watch).toBeNull()
    // Of a scan that is not there, or a set of another mesh: nothing to draw.
    made.tints.paint('S9', set)
    expect(made.tints.state().painting).toBeNull()
    made.tints.paint('S1', new TriangleSet(12))
    expect(made.tints.state().painting).toBeNull()
  })

  // Final fix wave (R2): a mesh that comes after the painting, or comes back, is painted on.
  it('is drawn once its scan’s mesh has come, and again when that mesh is let go of and comes back', () => {
    const redrawn = { count: 0 }
    const made = new ScanLayer(() => (redrawn.count += 1), () => new Promise(() => {}))
    made.set([scan('S1')], 'assembly')
    const set = new TriangleSet(1682)
    set.add(4)
    const paint = made.tints.paint('S1', set)!
    expect(paint).not.toBeNull()
    expect(made.tints.state().painting).toBeNull()
    made.load('S1', meshBin(grid(30)))
    expect(made.tints.state().painting).toEqual({ scan: 'S1', triangles: 1, visible: true })
    made.set([], 'assembly')
    expect(made.tints.state().painting).toBeNull()
    set.add(5)
    paint.touched()
    made.set([scan('S1')], 'assembly')
    made.load('S1', meshBin(grid(30)))
    expect(made.tints.state().painting).toEqual({ scan: 'S1', triangles: 2, visible: true })
    set.add(6)
    paint.touched()
    expect(made.tints.state().painting).toMatchObject({ triangles: 3 })
    expect(tintsOf(made)[0].geometry.drawRange.count).toBe(9)
    // Put away, it is not drawn when the mesh next comes.
    made.tints.paint(null, null)
    made.set([], 'assembly')
    made.set([scan('S1')], 'assembly')
    made.load('S1', meshBin(grid(30)))
    expect(made.tints.state().painting).toBeNull()
  })

  it('is no longer drawn once its scan’s mesh is let go of, and a touch then does nothing', () => {
    const { layer: made } = layer()
    const set = new TriangleSet(1682)
    const paint = made.tints.paint('S1', set)!
    made.set([], 'assembly')
    expect(made.tints.state().painting).toBeNull()
    set.add(3)
    expect(() => paint.touched()).not.toThrow()
  })
})
