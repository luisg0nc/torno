import { describe, expect, it } from 'vitest'
import type { SketchMark, SketchStroke } from '../../shared/marks'
import { sketchText, pointsTold } from './text'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }

const stroke = (over: Partial<SketchStroke> = {}): SketchStroke => ({ pen: 'free', revision: 41, plane: 1, points2d: [[0, 0]], ...over })

const sketch = (over: Partial<SketchMark> = {}): SketchMark => ({
  id: 'M7',
  kind: 'sketch',
  author: 'user',
  note: '',
  status: 'draft',
  anchorState: 'ok',
  layout: 'assembly',
  revision: 41,
  camera: CAMERA as SketchMark['camera'],
  createdAt: '2026-11-17T12:00:00.000Z',
  name: 'Breather hose route',
  take: 'flow',
  diameter: 19,
  planes: [
    { id: 1, origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0 (u = +X, v = +Z)', from: { kind: 'main', axis: 'XZ', offset: 40 } },
    { id: 2, origin: [0, 0, 50], x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31 (u = +X, v = +Y)', from: { kind: 'face', ref: 'block/F31', offset: 12, revision: 38 } }
  ],
  strokes: [
    stroke({ pen: 'line', points2d: [[12, 31.5], [40, 31.5]], snaps: [{ i: 0, centre: 'head/E14', radius: 8, projected: true }], touches: ['block/F3'] }),
    stroke({ plane: 2, points2d: [[0.04, 0.06], [10.26, 5]], touches: [] }),
    stroke({ plane: undefined, points2d: undefined, pen: 'points', points: [[1.234567, 2.345678, 3.456789], [4, 5, 6]], snaps: [{ i: 0, vertex: 'block/V12' }, { i: 1, edge: 'block/E40', approx: true }], touches: ['block/F1', 'block/F2'] })
  ],
  ...over
})

describe('sketchText', () => {
  const text = sketchText(sketch(), { revision: 41 })
  const lines = text.split('\n')

  it('says each plane with how it was made', () => {
    expect(lines).toContain('plane 1: XZ at y = 40.0 (u = +X, v = +Z); the main plane XZ, offset 40 mm; origin (0, 40, 0), u along (1, 0, 0), v along (0, 0, 1)')
    expect(text).toContain('plane 2: plane through block/F31 (u = +X, v = +Y); plane through block/F31 (face of build 38), offset 12 mm')
  })

  it('says each stroke with its pen, where it is, its length and what it touches', () => {
    expect(text).toContain('stroke 1: straight line on plane 1, 28 mm long, 2 points, drawn on build 41; touches block/F3 (of build 41)')
    expect(text).toContain('stroke 2: freehand on plane 2, 11.35 mm long, 2 points, drawn on build 41; touches nothing that was found (of build 41)')
    expect(text).toContain('stroke 3: point to point on the surface')
    expect(text).toContain('touches block/F1, block/F2 (of build 41)')
  })

  it('gives a snapped point in full with what it is, and a free one to 0.1 mm', () => {
    expect(text).toContain('p0 = (12.000, 40.000, 31.500) exact: centre of head/E14 (r 8), projected onto the plane')
    expect(lines).toContain('  p1 = (40.0, 40.0, 31.5) approximate')
    expect(lines).toContain('  p0 = (0.0, 0.1, 50.0) approximate')
    expect(lines).toContain('  p1 = (10.3, 5.0, 50.0) approximate')
    expect(text).toContain('p0 = (1.235, 2.346, 3.457) exact: vertex block/V12')
    expect(text).toContain('p1 = (4.000, 5.000, 6.000) approximate: on edge block/E40 (not a straight or circular edge, so only the edge is known)')
  })

  it('says how to take it, and the camera with how to look from it', () => {
    expect(text).toContain('Take it as a route: follow its path loosely, and keep its diameter clear.')
    expect(text).toContain('⌀19 mm')
    expect(text).toContain(`It was drawn from ${JSON.stringify(CAMERA)}: look with that as its view draws it again.`)
    expect(text).toContain('text only')
  })

  it('has a sentence for each take', () => {
    expect(sketchText(sketch({ take: 'exact', diameter: undefined }), {})).toContain('Take it exactly: follow these points to the millimetre.')
    expect(sketchText(sketch({ take: 'rough', diameter: undefined }), {})).toContain('Take it roughly: the shape and the place matter, not the exact points.')
  })

  it('says when the model was built again since', () => {
    expect(sketchText(sketch(), { revision: 44 })).toContain('The model has been built again since: r44 is the latest, and the refs and faces here are of the builds named, which may name other geometry now.')
    expect(text).not.toContain('built again')
  })

  it('names a tool as the client does', () => {
    expect(sketchText(sketch(), { toolName: (tool) => `mcp__torno__${tool}` })).toContain('mcp__torno__look with that as its view')
  })

  it('cuts at 2000 points and says what it left out', () => {
    const many = sketch({ strokes: Array.from({ length: 5 }, () => stroke({ points2d: Array.from({ length: 500 }, (_, i) => [i, 0] as [number, number]) })) })
    const cut = sketchText(many, { revision: 41 })
    expect(cut).toContain('stroke 4:')
    expect(cut).not.toContain('stroke 5:')
    expect(cut).toContain('… 1 more stroke, 500 points: read them with marks with ids ["M7"]')
    expect(pointsTold(many, {})).toBe(2000)
    // A lower limit leaves more out.
    const less = sketchText(many, { mostPoints: 1000 })
    expect(less).toContain('… 3 more strokes, 1,500 points: read them')
    expect(pointsTold(many, { mostPoints: 0 })).toBe(0)
  })
})
