import { describe, expect, it } from 'vitest'
import type { Vec3 } from './marks'
import type { Sectioned } from './geometry'
import type { Part } from './scene'
import type { SnapData } from './snapdata'
import { axesOfNormal, mainPlaneFrame } from './planes'
import {
  LAYER_COLOURS,
  MOST_LAYERS,
  MOST_SHAPES,
  MOST_TRACINGS,
  MOST_PLANE_VERTICES,
  MOST_TRACING_POINTS,
  PHOTO_MAIN_ONLY,
  TRACING_ID,
  TRACING_MAIN_ONLY,
  type Layer,
  type Tracing,
  type TracingPlane,
  inPlane,
  planeOfFrom,
  planeSnaps,
  pointCount,
  shapeCount,
  toObject,
  toUv,
  tracingName,
  validFrame
} from './tracings'

const layer = (shapes: Layer['shapes'], id = 1): Layer => ({ id, name: `layer ${id}`, colour: 'blue', by: 'agent', shapes, revision: 1 })
const tracing = (layers: Layer[] = [], name = ''): Tracing => ({
  id: 'T3',
  by: 'person',
  name,
  layout: 'assembly',
  createdAt: '2026-11-17T10:00:00.000Z',
  plane: { ...mainPlaneFrame('XZ', 0), from: { kind: 'main', axis: 'XZ', offset: 0 } },
  layers,
  nextLayer: layers.length + 1
})

describe('ids and caps', () => {
  it('knows a tracing id by its T and a number that starts above zero', () => {
    expect(TRACING_ID.test('T1')).toBe(true)
    expect(TRACING_ID.test('T123456789012345')).toBe(true)
    for (const bad of ['T0', 'T01', 'M1', 'T', 't1', 'T1x', 'T1234567890123456']) expect(TRACING_ID.test(bad)).toBe(false)
  })

  it('has the caps of the spec', () => {
    expect([MOST_TRACINGS, MOST_LAYERS, MOST_SHAPES, MOST_TRACING_POINTS]).toEqual([50, 20, 500, 20_000])
  })

  it('names the eight layer colours, red and green not among them', () => {
    expect([...LAYER_COLOURS]).toEqual(['blue', 'teal', 'violet', 'ochre', 'plum', 'slate', 'sky', 'olive'])
  })

  it('names what is main\'s', () => {
    expect([...TRACING_MAIN_ONLY]).toEqual(['id', 'by', 'nextLayer', 'lost'])
    expect([...PHOTO_MAIN_ONLY]).toEqual(['file', 'sha256', 'width', 'height', 'transform', 'scale', 'angle', 'fit', 'straightened'])
  })
})

describe('tracingName', () => {
  it('says Tracing T3 when the name is empty', () => {
    expect(tracingName(tracing())).toBe('Tracing T3')
    expect(tracingName(tracing([], 'front'))).toBe('front')
  })
})

describe('the plane', () => {
  const tilted = (): TracingPlane => {
    const axes = axesOfNormal([1, 2, 3]) as { x: Vec3; y: Vec3 }
    return { origin: [10, -4, 7.5], x: axes.x, y: axes.y, label: 'tilted', from: { kind: 'section', origin: [10, -4, 7.5], normal: [1, 2, 3] } }
  }

  it('turns uv into the object frame and back on a tilted plane', () => {
    const plane = tilted()
    for (const uv of [[0, 0], [12.5, -3], [-40, 99.25]] as Array<[number, number]>) {
      const back = toUv(plane, toObject(plane, uv))
      expect(back[0]).toBeCloseTo(uv[0], 9)
      expect(back[1]).toBeCloseTo(uv[1], 9)
    }
    const p: Vec3 = [3, 8, -2]
    const there = toUv(plane, p)
    const same = toObject(plane, there)
    expect(inPlane(plane, same)).toBe(true)
    // p is off the plane: going through uv puts it on the plane, not back where it was.
    expect(inPlane(plane, p)).toBe(false)
  })

  it('has uv = [x, z] on the XZ plane at its offset', () => {
    const plane = { ...mainPlaneFrame('XZ', 40), from: { kind: 'main' as const, axis: 'XZ' as const, offset: 40 } }
    expect(toObject(plane, [5, 7])).toEqual([5, 40, 7])
    expect(toUv(plane, [5, 40, 7])).toEqual([5, 7])
  })

  it('says a point 2e-6 mm off is not in the plane, and 5e-7 is', () => {
    const plane = tilted()
    const n = [plane.x[1] * plane.y[2] - plane.x[2] * plane.y[1], plane.x[2] * plane.y[0] - plane.x[0] * plane.y[2], plane.x[0] * plane.y[1] - plane.x[1] * plane.y[0]]
    const on = toObject(plane, [3, 4])
    const off = (d: number): Vec3 => [on[0] + n[0] * d, on[1] + n[1] * d, on[2] + n[2] * d]
    expect(inPlane(plane, on)).toBe(true)
    expect(inPlane(plane, off(5e-7))).toBe(true)
    expect(inPlane(plane, off(2e-6))).toBe(false)
    expect(inPlane(plane, off(2e-6), 1e-5)).toBe(true)
  })

  it('makes a main plane through the one rule, its label included', () => {
    const plane = planeOfFrom({ kind: 'main', axis: 'YZ', offset: 12 })
    const frame = mainPlaneFrame('YZ', 12)
    expect(plane).toEqual({ ...frame, from: { kind: 'main', axis: 'YZ', offset: 12 } })
    expect(plane?.label).toBe('YZ at x = 12.0 (u = +Y, v = +Z)')
  })

  it('leaves the face and section frames to main', () => {
    expect(planeOfFrom({ kind: 'face', ref: 'block/F1', revision: 2 })).toBeNull()
    expect(planeOfFrom({ kind: 'section', origin: [0, 0, 0], normal: [0, 0, 1] })).toBeNull()
  })

  it('knows a frame that is orthonormal', () => {
    expect(validFrame([1, 0, 0], [0, 1, 0])).toBe(true)
    expect(validFrame([1, 0, 0], [0, 1, 1e-7])).toBe(true)
    expect(validFrame([1, 0, 0], [0, 1.001, 0])).toBe(false)
    expect(validFrame([1, 0, 0], [1, 0, 0])).toBe(false)
    expect(validFrame([1, 0, 0], [0, 0.6, 0.8 + 1e-3])).toBe(false)
    expect(validFrame([1, 0, 0], [0, Number.NaN, 1])).toBe(false)
  })
})

describe('counting', () => {
  it('counts the shapes of every layer, and the points of the polylines', () => {
    const t = tracing([
      layer([{ kind: 'polyline', points: [[0, 0], [1, 0], [1, 1]] }, { kind: 'circle', centre: [0, 0], radius: 2 }], 1),
      layer([{ kind: 'label', at: [0, 0], text: 'x' }, { kind: 'polyline', points: [[0, 0], [5, 5]], closed: true }], 2)
    ])
    expect(shapeCount(t)).toBe(4)
    expect(pointCount(t)).toBe(5)
    expect(shapeCount(tracing())).toBe(0)
    expect(pointCount(tracing())).toBe(0)
  })
})

describe('planeSnaps', () => {
  const plane = { ...mainPlaneFrame('XY', 0) }
  const partAt = (name: string, loc: Part['loc'] = { t: [0, 0, 0], q: [0, 0, 0, 1] }): Part => ({ name, loc }) as unknown as Part
  const snapOfPoints = (points: Vec3[]): SnapData => ({ points: new Float32Array(points.flat()), circles: new Float32Array() })
  const box: Sectioned = {
    plane: { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
    bounds: { min: [0, 0], max: [10, 10] },
    parts: [
      {
        part: 'block',
        area: 100,
        areaExact: true,
        open: 0,
        how: 'cross-section of the solid',
        loops: [{ points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true, area: 100, areaExact: true, deflection: 0.01, corners: [[0, 0], [10, 0], [10, 10], [0, 10]], circles: [{ centre: [5, 5], radius: 2, edge: 'E4' }] }]
      }
    ]
  }

  it("gives a box's four corners plain, and the circle's centre with its edge", () => {
    const snaps = planeSnaps(plane, [{ part: partAt('block') }], box)
    expect(snaps.filter((s) => s.kind === 'corner')).toEqual([0, 1, 2, 3].map((i) => ({ kind: 'corner', uv: box.parts[0].loops[0].corners![i], part: 'block' })))
    expect(snaps.filter((s) => s.kind === 'centre')).toEqual([{ kind: 'centre', uv: [5, 5], radius: 2, part: 'block', edge: 'E4' }])
    expect(snaps.some((s) => 'projected' in s)).toBe(false)
  })

  it('gives a vertex in the plane plain and one 5 mm off it as projected, in the object frame of the part', () => {
    const snaps = planeSnaps(plane, [{ part: partAt('block'), snap: snapOfPoints([[10, 0, 0.005], [3, 4, 5]]) }], box)
    const vertices = snaps.filter((s) => s.kind === 'vertex')
    expect(vertices).toEqual([
      { kind: 'vertex', uv: [10, 0], part: 'block', ref: 'block/V0' },
      { kind: 'vertex', uv: [3, 4], part: 'block', ref: 'block/V1', projected: true }
    ])
  })

  it('applies the part\'s loc to its vertices', () => {
    // A quarter turn about Z, then 100 mm along X: the part-local (1, 0, 0) is (100, 1, 0).
    const s = Math.SQRT1_2
    const loc: Part['loc'] = { t: [100, 0, 0], q: [0, 0, s, s] }
    const snaps = planeSnaps(plane, [{ part: partAt('lid', loc), snap: snapOfPoints([[1, 0, 0]]) }], { ...box, parts: [] })
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({ kind: 'vertex', part: 'lid', ref: 'lid/V0' })
    expect((snaps[0] as { uv: [number, number] }).uv[0]).toBeCloseTo(100, 4)
    expect((snaps[0] as { uv: [number, number] }).uv[1]).toBeCloseTo(1, 4)
  })

  it('offers the vertices nearest the plane first and no more than the most', () => {
    const points: Vec3[] = Array.from({ length: MOST_PLANE_VERTICES + 50 }, (_, i) => [i, 0, i % 2 === 0 ? 0 : 3 + i])
    const snaps = planeSnaps(plane, [{ part: partAt('block'), snap: snapOfPoints(points) }], { ...box, parts: [] })
    expect(snaps).toHaveLength(MOST_PLANE_VERTICES)
    expect(snaps.filter((s) => 'projected' in s)).toHaveLength(MOST_PLANE_VERTICES - Math.ceil((MOST_PLANE_VERTICES + 50) / 2))
  })

  it('ignores a part with no snap data', () => {
    expect(planeSnaps(plane, [{ part: partAt('block') }], { ...box, parts: [] })).toEqual([])
  })
})
