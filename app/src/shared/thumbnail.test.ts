import { describe, expect, it } from 'vitest'
import type { Part, Scene } from './scene'
import { BENCH_MM_PER_PX, layoutSize, thumbnailLayout, thumbnailPlan } from './thumbnail'

it('is of the assembly when there is one, else of the first layout, and of none when there is none', () => {
  expect(thumbnailLayout(['print', 'assembly'])).toBe('assembly')
  expect(thumbnailLayout(['print'])).toBe('print')
  expect(thumbnailLayout([])).toBeNull()
})

const BUF = { offset: 0, length: 0 }
const MESH = { vertices: BUF, normals: BUF, triangles: BUF, edges: BUF, trianglesPerFace: BUF, segmentsPerEdge: BUF, faceTypes: BUF, edgeTypes: BUF }
const BOXES: Record<string, Part['bbox']> = { tub: { min: [-20, -15, 0], max: [20, 15, 20] }, lid: { min: [-20, -15, 20], max: [20, 15, 24] } }
const part = (layout: string, name: string): Part => ({ key: `${layout}:${name}`, name, layout, loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: BOXES[name], volume: 1, faceCount: 6, edgeCount: 12, triangleCount: 12, valid: true, hash: name, mesh: MESH })
const HOLLOW: Scene = { model: 'hollow.py', layouts: ['print', 'assembly'], parts: [part('print', 'tub'), part('print', 'lid'), part('assembly', 'tub'), part('assembly', 'lid')], seconds: 0.1, output: '' }

describe('thumbnailPlan', () => {
  it('draws, with no saved view, every part of the layout a thumbnail is of, whole and together', () => {
    const plan = thumbnailPlan(HOLLOW)!
    expect(plan.layout).toBe('assembly')
    expect(plan.parts.map((p) => p.key)).toEqual(['assembly:tub', 'assembly:lid'])
    expect(plan).toMatchObject({ hidden: 0, section: null, explode: null, offsets: {} })
    expect(thumbnailPlan({ ...HOLLOW, parts: [], layouts: [] })).toBeNull()
    expect(thumbnailPlan({ ...HOLLOW, parts: HOLLOW.parts.filter((p) => p.layout === 'print') })).toBeNull()
  })

  it('draws the object as it was last looked at: its layout, the parts switched on, in their colours', () => {
    const plan = thumbnailPlan(HOLLOW, { layout: 'print', layers: { lid: { visible: false }, tub: { color: '#123456', opacity: 0.5 } } })!
    expect(plan.layout).toBe('print')
    expect(plan.parts.map((p) => p.key)).toEqual(['print:tub'])
    expect(plan.hidden).toBe(1)
    expect(plan.looks['print:tub']).toEqual({ color: '#123456', opacity: 0.5 })
    // A layout the build no longer has is not drawn: the one a thumbnail is of otherwise.
    expect(thumbnailPlan(HOLLOW, { layout: 'bed', layers: {} })!.layout).toBe('assembly')
    // Every part switched off is a picture of nothing: the parts are drawn, and none is said to be left out.
    expect(thumbnailPlan(HOLLOW, { layers: { lid: { visible: false }, tub: { visible: false } } })).toMatchObject({ hidden: 0, parts: [{ name: 'tub' }, { name: 'lid' }] })
  })

  it('takes a part thinned to nothing as one switched off, and never draws one that cannot be seen', () => {
    const plan = thumbnailPlan(HOLLOW, { layers: { lid: { opacity: 0 } } })!
    expect(plan.parts.map((p) => p.name)).toEqual(['tub'])
    expect(plan.hidden).toBe(1)
    // Both thinned to nothing: all are drawn, whole.
    const all = thumbnailPlan(HOLLOW, { layers: { lid: { opacity: 0 }, tub: { opacity: 0 } } })!
    expect(all).toMatchObject({ hidden: 0, parts: [{ name: 'tub' }, { name: 'lid' }] })
    expect(Object.values(all.looks).map((look) => look.opacity)).toEqual([1, 1])
  })

  it('gives each part the colour it has in the window: by its place among the names of the whole scene', () => {
    const plan = thumbnailPlan(HOLLOW)!
    expect(plan.looks['assembly:lid']).toEqual({ color: '#7B93B4', opacity: 1 })
    expect(plan.looks['assembly:tub']).toEqual({ color: '#C28B6C', opacity: 1 })
  })

  it('cuts the parts by the section kept, or draws them apart, never both, by the one rule', () => {
    const section = { origin: [0, 0, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number] }
    const apart = { assembly: { amount: 0.5, scale: 1, axis: 'z' as const } }
    const cut = thumbnailPlan(HOLLOW, { layers: {}, section, explode: apart })!
    expect(cut).toMatchObject({ section, explode: null, offsets: {} })
    const exploded = thumbnailPlan(HOLLOW, { layers: {}, explode: apart })!
    expect(exploded.section).toBeNull()
    expect(exploded.explode).toEqual(apart.assembly)
    expect(exploded.offsets.lid[2]).toBeGreaterThan(0)
    // Along z the lowest part stays: nothing is drawn under the ground.
    expect(exploded.offsets.tub[2]).toBe(0)
    // An explode kept for another layout is not this one's.
    expect(thumbnailPlan(HOLLOW, { layers: {}, explode: { print: apart.assembly } })!.explode).toBeNull()
    // One part drawn alone is not apart from anything, though the layout is.
    expect(thumbnailPlan(HOLLOW, { layers: { lid: { visible: false } }, explode: apart })).toMatchObject({ explode: apart.assembly, hidden: 1 })
  })

  it('leaves out a section that would leave nothing of what is drawn, and one that is no plane', () => {
    const beyond = { origin: [0, 0, -5] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }
    expect(thumbnailPlan(HOLLOW, { layers: {}, section: beyond })!.section).toBeNull()
    expect(thumbnailPlan(HOLLOW, { layers: {}, section: { origin: [0, 0, 0], normal: [0, 0, 0] } })!.section).toBeNull()
  })
})

describe('the bench mode', () => {
  const scaled = (k: number): Scene => ({ ...HOLLOW, parts: HOLLOW.parts.map((p) => ({ ...p, bbox: { min: p.bbox.min.map((v) => v * k) as [number, number, number], max: p.bbox.max.map((v) => v * k) as [number, number, number] } })) })

  it('is a fixed iso camera on a clear ground at 0.5 mm to the pixel, whatever the size of the parts', () => {
    expect(BENCH_MM_PER_PX).toBe(0.5)
    for (const scene of [HOLLOW, scaled(0.1), scaled(40)]) {
      expect(thumbnailPlan(scene, undefined, { bench: true })!.bench).toEqual({ mmPerPx: BENCH_MM_PER_PX, view: 'iso', ground: 'clear' })
    }
  })

  it('leaves the plan as it was when the mode is not asked for, and changes nothing else when it is', () => {
    expect(thumbnailPlan(HOLLOW)!.bench).toBeNull()
    const withBench = thumbnailPlan(HOLLOW, undefined, { bench: true })!
    const { bench: _on, ...rest } = withBench
    const { bench: _off, ...plain } = thumbnailPlan(HOLLOW)!
    expect(rest).toEqual(plain)
  })
})

describe('layoutSize', () => {
  it('is the size of the layout as built, and exact only where the kernel says every part box is', () => {
    expect(layoutSize(HOLLOW, 'assembly')).toEqual({ x: 40, y: 30, z: 24, exact: false })
    const exact: Scene = { ...HOLLOW, parts: HOLLOW.parts.map((p) => ({ ...p, bboxExact: true })) }
    expect(layoutSize(exact, 'assembly')).toEqual({ x: 40, y: 30, z: 24, exact: true })
    // One part with an approximate box makes the whole approximate.
    const one: Scene = { ...exact, parts: exact.parts.map((p) => (p.name === 'lid' ? { ...p, bboxExact: false } : p)) }
    expect(layoutSize(one, 'assembly')).toMatchObject({ exact: false })
    expect(layoutSize(exact, 'bed')).toBeNull()
  })
})
