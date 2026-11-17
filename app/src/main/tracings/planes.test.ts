import { describe, expect, it, vi } from 'vitest'
import type { Described, Sectioned } from '../../shared/geometry'
import type { Scene } from '../../shared/scene'
import type { Tracing, TracingPlane } from '../../shared/tracings'
import type { AskedAnchor, NearestAnchor } from '../marks/reanchor'
import { Refusal } from '../refusal'
import { type FaceKernel, type RefindAsk, faceFrame, followFace, followFaces, sectionFrame } from './planes'

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

/** What the kernel's `refind` says of a face it found where it was stored. */
const placed = (over: Record<string, unknown> = {}) => ({ found: 'nearest', ref: 'block/F31', point: [7, 2, 10.3], normal: [0, 0, 1], type: 'PLANE', ...over })
const refinding = (answer: (member: RefindAsk) => unknown = () => placed()) => vi.fn(async (_layout: string, members: RefindAsk[]) => members.map(answer))
/** What `nearest` says of the face a tag names. */
const tagged = (over: Record<string, unknown> = {}) => ({ part: 'block', found: true, point: [0, 0, 0], normal: [0, 0, 1], ref: 'block/F2', distance: 0, descriptor: 'plane', faceFound: true, faceDistance: 4, facePoint: [1, 1, 14], faceNormal: [0, 0, 1], faceDescriptor: 'plane, normal +Z, z = 14, 100 mm²', ...over }) as NearestAnchor
const nearesting = (answer: (anchor: AskedAnchor) => NearestAnchor = () => tagged()) => vi.fn(async (_layout: string, anchors: AskedAnchor[]) => anchors.map(answer))
const kernel = (refind = refinding(), nearest = nearesting()): FaceKernel => ({ refind, nearest })
const LOST = { lost: 'block/F31 is not in this plane any more' }
const withTag = (tag: string): TracingPlane => ({ ...top, from: { kind: 'face', ref: 'block/F31', tag, revision: 1 } })

describe('followFace', () => {
  it('asks the kernel to find the face where it was, by type, point and normal, and moves the origin along the normal to it', async () => {
    const refind = refinding()
    const got = await followFace(tracing(), scene(), kernel(refind))
    // 0.3 mm along the normal: the point of the face the kernel gave (7, 2) is not where the origin goes.
    expect(got).toEqual({ origin: [5, 5, 10.3], ref: 'block/F31' })
    expect(refind).toHaveBeenCalledWith('assembly', [{ part: 'block', kind: 'face', type: 'PLANE', point: [5, 5, 10], normal: [0, 0, 1], within: 0.5 }])
  })

  it('follows the face a tag names first, by nearest, whatever number it has now, however far it moved', async () => {
    const refind = refinding()
    const nearest = nearesting()
    expect(await followFace(tracing('T1', withTag('top')), scene({ top: { faces: [7] } }), kernel(refind, nearest))).toEqual({ origin: [5, 5, 14], ref: 'block/F7' })
    expect(nearest).toHaveBeenCalledWith('assembly', [{ part: 'block', point: [5, 5, 10], face: 'block/F7' }])
    expect(refind).not.toHaveBeenCalled()
  })

  it('names the face it found by place when that is numbered otherwise now', async () => {
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ ref: 'block/F12' }))))).toEqual({ origin: [5, 5, 10.3], ref: 'block/F12' })
  })

  it('finds it by place when the tag is on no single face now', async () => {
    const refind = refinding()
    expect(await followFace(tracing('T1', withTag('gone')), scene({ top: { faces: [7] } }), kernel(refind))).toEqual({ origin: [5, 5, 10.3], ref: 'block/F31' })
    expect(refind).toHaveBeenCalledTimes(1)
  })

  it('does not move an origin that the face is still in', async () => {
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ point: [7, 2, 10] }))))).toEqual({ origin: [5, 5, 10], ref: 'block/F31' })
  })

  it('is lost when the kernel finds nothing: no part, the layout has no such part, the face is gone', async () => {
    expect(await followFace(tracing(), scene(), kernel(refinding(() => ({ found: 'lost', why: 'nothing there' }))))).toEqual(LOST)
    const none = kernel(vi.fn(), vi.fn())
    expect(await followFace(tracing('T1', top, 'nowhere'), scene(), none)).toEqual(LOST)
    expect(await followFace(tracing(), { ...scene(), parts: [] } as Scene, none)).toEqual(LOST)
    expect(none.refind).not.toHaveBeenCalled()
  })

  it('never takes a face of another type than a plane, whatever the kernel found nearest, such as the wall of a hole the point is on the rim of', async () => {
    // The wall's normal where the rim point is can be parallel to the plane's: only its type says it is no plane.
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ type: 'CYLINDER', ref: 'block/F0' }))))).toEqual(LOST)
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ type: undefined }))))).toEqual(LOST)
    expect(await followFace(tracing('T1', withTag('top')), scene({ top: { faces: [7] } }), kernel(refinding(), nearesting(() => tagged({ faceDescriptor: 'cylinder, radius 5, 100 mm²' }))))).toEqual({ lost: 'block/F31 is not in this plane any more' })
  })

  it('is lost when what is there is no longer parallel', async () => {
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ normal: [1, 0, 0] }))))).toEqual(LOST)
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ normal: [0, 0.05, 0.9987] }))))).toEqual(LOST)
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ normal: undefined }))))).toEqual(LOST)
  })

  it('takes a face that now looks the other way as still parallel', async () => {
    expect(await followFace(tracing(), scene(), kernel(refinding(() => placed({ normal: [0, 0, -1] }))))).toEqual({ origin: [5, 5, 10.3], ref: 'block/F31' })
  })

  it('works along a slanted normal, not along an axis', async () => {
    const s = Math.SQRT1_2
    // x = +X, y = (0, s, s): the normal x × y = (0, -s, s).
    const plane: TracingPlane = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, s, s], label: 'slant', from: { kind: 'face', ref: 'block/F31', revision: 1 } }
    const refind = refinding(() => placed({ point: [3, -1, 1], normal: [0, -s, s] }))
    const got = await followFace(tracing('T1', plane), scene(), kernel(refind))
    expect((refind.mock.calls[0][1][0] as RefindAsk).normal.map((c) => Number(c.toFixed(9)))).toEqual([0, Number((-s).toFixed(9)), Number(s.toFixed(9))])
    // (3, -1, 1) · (0, -s, s) = 2s along the normal.
    expect('origin' in got && got.origin.map((c) => Number(c.toFixed(9)))).toEqual([0, Number((-2 * s * s).toFixed(9)), Number((2 * s * s).toFixed(9))])
  })

  it('rejects when the kernel cannot answer, and does not say the face is lost', async () => {
    await expect(followFace(tracing(), scene(), kernel(vi.fn().mockRejectedValue(new Error('the kernel is still busy'))))).rejects.toThrow(/busy/)
    await expect(followFace(tracing(), scene(), kernel(refinding(() => ({ found: 'nearest', ref: 'lid/F1', point: [0, 0, 0], normal: [0, 0, 1], type: 'PLANE' }))))).rejects.toThrow(/ref/)
    await expect(followFace(tracing(), scene(), kernel(vi.fn().mockResolvedValue([])))).rejects.toThrow(/each/)
  })
})

describe('followFaces', () => {
  it('asks once for each layout, for all its face tracings', async () => {
    const refind = refinding((m) => placed({ point: [0, 0, m.point[2] + 1] }))
    const got = await followFaces([tracing('T1'), tracing('T2', { ...top, origin: [5, 5, 20] }), tracing('T3', top, 'print')], scene(), kernel(refind))
    expect(refind).toHaveBeenCalledTimes(2)
    expect(got.get('T1')).toEqual({ origin: [5, 5, 11], ref: 'block/F31' })
    expect(got.get('T2')).toEqual({ origin: [5, 5, 21], ref: 'block/F31' })
    expect(got.get('T3')).toEqual({ origin: [5, 5, 11], ref: 'block/F31' })
  })

  it('says of the tracings of a layout whose query failed that it failed, and still answers the others', async () => {
    const refind = vi.fn(async (layout: string, members: RefindAsk[]) => {
      if (layout === 'print') throw new Error('the kernel is still busy')
      return members.map(() => placed())
    })
    const got = await followFaces([tracing('T1'), tracing('T3', top, 'print')], scene(), kernel(refind))
    expect(got.get('T1')).toEqual({ origin: [5, 5, 10.3], ref: 'block/F31' })
    expect(got.get('T3')).toMatchObject({ failed: expect.objectContaining({ message: 'the kernel is still busy' }) })
  })
})

const face = (over: Partial<Extract<Described, { kind: 'face' }>> = {}): Described => ({ kind: 'face', ref: 'block/F31', type: 'plane', area: 100, center: [5, 5, 10], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 10, 100 mm²', ...over })

describe('faceFrame', () => {
  it('makes the frame of a planar face: a point on it, axes from its normal, the label', () => {
    expect(faceFrame('block/F31', face(), [1, 2, 10])).toEqual({ origin: [1, 2, 10], x: [1, 0, 0], y: [0, 1, 0], label: 'plane through block/F31 offset 0 mm (u = +X, v = +Y)' })
  })

  it('refuses a curved face, an edge, and a face with no normal, in words', () => {
    expect(() => faceFrame('block/F2', face({ type: 'cylinder', normal: [1, 0, 0], radius: 5 }), [0, 0, 0])).toThrow(new Refusal('block/F2 is a cylinder, not a plane: a tracing lies on a flat face'))
    expect(() => faceFrame('block/E2', { kind: 'edge', ref: 'block/E2', type: 'line', length: 4, center: [0, 0, 0], descriptor: 'line' }, [0, 0, 0])).toThrow(/block\/E2 is an edge/)
    expect(() => faceFrame('block/F2', face({ normal: null }), [0, 0, 0])).toThrow(Refusal)
    expect(() => faceFrame('block/F2', face(), [0, Number.NaN, 0] as never)).toThrow(Refusal)
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
