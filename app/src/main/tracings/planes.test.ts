import { describe, expect, it, vi } from 'vitest'
import type { Described, Sectioned } from '../../shared/geometry'
import type { Scene } from '../../shared/scene'
import type { Tracing, TracingPlane } from '../../shared/tracings'
import type { AskedAnchor, NearestAnchor } from '../marks/reanchor'
import { Refusal } from '../refusal'
import { faceFrame, followFace, followFaces, sectionFrame } from './planes'

const top: TracingPlane = { origin: [5, 5, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31', from: { kind: 'face', ref: 'block/F31', revision: 1 } }
const tracing = (id = 'T1', plane: TracingPlane = top, layout = 'assembly'): Tracing => ({ id, by: 'person', name: '', layout, createdAt: '2026-11-17T12:00:00.000Z', plane, layers: [], nextLayer: 1 })
const scene = (tags?: Record<string, { faces?: number[] }>): Scene =>
  ({
    layouts: ['assembly', 'print'],
    parts: [
      { name: 'block', layout: 'assembly', bbox: { min: [0, 0, 0], max: [10, 10, 10] }, ...(tags ? { tags } : {}) },
      { name: 'block', layout: 'print', bbox: { min: [0, 0, 0], max: [10, 10, 10] } }
    ]
  }) as unknown as Scene

const found = (over: Record<string, unknown>): NearestAnchor => ({ part: 'block', found: true, point: [7, 2, 10.3], normal: [0, 0, 1], ref: 'block/F31', distance: 0.3, descriptor: 'plane, normal +Z, z = 10.3, 100 mm²', ...over }) as NearestAnchor
const asking = (answer: (anchor: AskedAnchor) => NearestAnchor) => vi.fn(async (_layout: string, anchors: AskedAnchor[]) => anchors.map(answer))

describe('followFace', () => {
  it('moves the origin along the normal to the planar face nearest it, and leaves x and y', async () => {
    const nearest = asking(() => found({}))
    const got = await followFace(tracing(), scene(), nearest)
    // 0.3 mm along the normal: the point of the face the kernel gave (7, 2) is not where the origin goes.
    expect(got).toEqual({ origin: [5, 5, 10.3] })
    expect(nearest).toHaveBeenCalledWith('assembly', [{ part: 'block', point: [5, 5, 10] }])
  })

  it('follows the face a tag names first, whatever number it has now, however far it moved', async () => {
    const nearest = asking((a) => (a.face === 'block/F7' ? found({ faceFound: true, faceDistance: 4, facePoint: [1, 1, 14], faceNormal: [0, 0, 1], faceDescriptor: 'plane, normal +Z, z = 14, 100 mm²', ref: 'block/F2', distance: 0 }) : found({})))
    const plane: TracingPlane = { ...top, from: { kind: 'face', ref: 'block/F31', tag: 'top', revision: 1 } }
    expect(await followFace(tracing('T1', plane), scene({ top: { faces: [7] } }), nearest)).toEqual({ origin: [5, 5, 14] })
    expect(nearest).toHaveBeenCalledWith('assembly', [{ part: 'block', point: [5, 5, 10], face: 'block/F7' }])
  })

  it('asks by position when the tag is on no single face now', async () => {
    const nearest = asking(() => found({}))
    const plane: TracingPlane = { ...top, from: { kind: 'face', ref: 'block/F31', tag: 'gone', revision: 1 } }
    expect(await followFace(tracing('T1', plane), scene({ top: { faces: [7] } }), nearest)).toEqual({ origin: [5, 5, 10.3] })
    expect(nearest).toHaveBeenCalledWith('assembly', [{ part: 'block', point: [5, 5, 10] }])
  })

  it('does not move an origin that the face is still in', async () => {
    expect(await followFace(tracing(), scene(), asking(() => found({ point: [7, 2, 10], distance: 0 })))).toEqual({ origin: [5, 5, 10] })
  })

  it('is lost when the face is gone: nothing within reach, no part, the layout has no such part', async () => {
    const lost = { lost: 'block/F31 is not in this plane any more' }
    expect(await followFace(tracing(), scene(), asking(() => found({ distance: 3 })))).toEqual(lost)
    expect(await followFace(tracing(), scene(), asking(() => ({ part: 'block', found: false })))).toEqual(lost)
    const none = vi.fn()
    expect(await followFace(tracing('T1', top, 'nowhere'), scene(), none)).toEqual(lost)
    expect(await followFace(tracing(), { ...scene(), parts: [] } as Scene, none)).toEqual(lost)
    expect(none).not.toHaveBeenCalled()
  })

  it('is lost when what is there is no longer parallel, or is not a plane', async () => {
    const lost = { lost: 'block/F31 is not in this plane any more' }
    expect(await followFace(tracing(), scene(), asking(() => found({ normal: [1, 0, 0] })))).toEqual(lost)
    expect(await followFace(tracing(), scene(), asking(() => found({ normal: [0, 0.05, 0.9987] })))).toEqual(lost)
    expect(await followFace(tracing(), scene(), asking(() => found({ descriptor: 'cylinder, radius 5, 100 mm²' })))).toEqual(lost)
    expect(await followFace(tracing(), scene(), asking(() => found({ normal: null })))).toEqual(lost)
  })

  it('takes a face that now looks the other way as still parallel', async () => {
    expect(await followFace(tracing(), scene(), asking(() => found({ normal: [0, 0, -1] })))).toEqual({ origin: [5, 5, 10.3] })
  })

  it('works along a slanted normal, not along an axis', async () => {
    const s = Math.SQRT1_2
    // x = +X, y = (0, s, s): the normal x × y = (0, -s, s).
    const plane: TracingPlane = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, s, s], label: 'slant', from: { kind: 'face', ref: 'block/F31', revision: 1 } }
    const got = await followFace(tracing('T1', plane), scene(), asking(() => found({ point: [3, -1, 1], normal: [0, -s, s], distance: 0.2 })))
    // (3, -1, 1) · (0, -s, s) = 2s along the normal.
    expect('origin' in got && got.origin.map((c) => Number(c.toFixed(9)))).toEqual([0, Number((-2 * s * s).toFixed(9)), Number((2 * s * s).toFixed(9))])
  })

  it('rejects when the kernel cannot answer, and does not say the face is lost', async () => {
    await expect(followFace(tracing(), scene(), vi.fn().mockRejectedValue(new Error('the kernel is still busy')))).rejects.toThrow(/busy/)
    await expect(followFace(tracing(), scene(), asking(() => ({ part: 'block', found: true, error: 'no point' }) as NearestAnchor))).rejects.toThrow(/no point/)
  })
})

describe('followFaces', () => {
  it('asks once for each layout, for all its face tracings', async () => {
    const nearest = asking((a) => found({ point: [0, 0, a.point[2] + 1] }))
    const got = await followFaces([tracing('T1'), tracing('T2', { ...top, origin: [5, 5, 20] }), tracing('T3', top, 'print')], scene(), nearest)
    expect(nearest).toHaveBeenCalledTimes(2)
    expect(got.get('T1')).toEqual({ origin: [5, 5, 11] })
    expect(got.get('T2')).toEqual({ origin: [5, 5, 21] })
    expect(got.get('T3')).toEqual({ origin: [5, 5, 11] })
  })

  it('says of the tracings of a layout whose query failed that it failed, and still answers the others', async () => {
    const nearest = vi.fn(async (layout: string, anchors: AskedAnchor[]) => {
      if (layout === 'print') throw new Error('the kernel is still busy')
      return anchors.map(() => found({}))
    })
    const got = await followFaces([tracing('T1'), tracing('T3', top, 'print')], scene(), nearest)
    expect(got.get('T1')).toEqual({ origin: [5, 5, 10.3] })
    expect(got.get('T3')).toMatchObject({ failed: expect.objectContaining({ message: 'the kernel is still busy' }) })
  })
})

const face = (over: Partial<Extract<Described, { kind: 'face' }>> = {}): Described => ({ kind: 'face', ref: 'block/F31', type: 'plane', area: 100, center: [5, 5, 10], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 10, 100 mm²', ...over })

describe('faceFrame', () => {
  it('makes the frame of a planar face: its centre, axes from its normal, the label', () => {
    expect(faceFrame('block/F31', face())).toEqual({ origin: [5, 5, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31 offset 0 mm (u = +X, v = +Y)' })
  })

  it('refuses a curved face, an edge, and a face with no normal, in words', () => {
    expect(() => faceFrame('block/F2', face({ type: 'cylinder', normal: [1, 0, 0], radius: 5 }))).toThrow(new Refusal('block/F2 is a cylinder, not a plane: a tracing lies on a flat face'))
    expect(() => faceFrame('block/E2', { kind: 'edge', ref: 'block/E2', type: 'line', length: 4, center: [0, 0, 0], descriptor: 'line' })).toThrow(/block\/E2 is an edge/)
    expect(() => faceFrame('block/F2', face({ normal: null }))).toThrow(Refusal)
  })
})

describe('sectionFrame', () => {
  const cut: Sectioned['plane'] = { origin: [0, 0, 12.5], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }

  it('is the section on screen, frozen, with the axes the kernel gave', () => {
    const frame = sectionFrame({ origin: [3, 4, 12.5], normal: [0, 0, 1] }, cut)
    expect(frame).toMatchObject({ origin: [3, 4, 12.5], x: [1, 0, 0], y: [0, 1, 0] })
    expect(frame.label).toMatch(/^section through \(3, 4, 12\.5\), normal \+Z \(u = \+X, v = \+Y\)$/)
  })

  it('refuses axes that are not a frame of that plane', () => {
    expect(() => sectionFrame({ origin: [0, 0, 0], normal: [0, 0, 1] }, { ...cut, x: [1, 0, 0], y: [0, 0, 1] })).toThrow(Refusal)
    expect(() => sectionFrame({ origin: [0, 0, 0], normal: [0, 0, 1] }, { ...cut, x: [2, 0, 0] })).toThrow(Refusal)
  })
})
