import { describe, expect, it } from 'vitest'
import type { Vec3 } from './marks'
import { axesOfNormal, mainPlaneFrame } from './planes'
import {
  LAYER_COLOURS,
  MOST_LAYERS,
  MOST_SHAPES,
  MOST_TRACINGS,
  MOST_TRACING_POINTS,
  PHOTO_MAIN_ONLY,
  TRACING_ID,
  TRACING_MAIN_ONLY,
  type Layer,
  type Tracing,
  type TracingPlane,
  inPlane,
  planeOfFrom,
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
