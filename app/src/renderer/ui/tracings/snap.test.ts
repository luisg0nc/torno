import { describe, expect, it } from 'vitest'
import type { PlaneSnap } from '../../../shared/tracings'
import { SNAP_PX, snapAt } from './snap'

/** Ten pixels to the millimetre, so that a pixel is a tenth of one. */
const K = 10
const corner: PlaneSnap = { kind: 'corner', uv: [40, 30], part: 'block' }
const centre: PlaneSnap = { kind: 'centre', uv: [20, 15], radius: 8, part: 'head', edge: 'E14' }
const vertex: PlaneSnap = { kind: 'vertex', uv: [0, 0], part: 'block', ref: 'block/V3' }

describe('snapAt', () => {
  it('takes a corner 8 px away and gives its point, not the pointer’s', () => {
    const got = snapAt([corner], [40.8, 30], K, false)
    expect(got).toEqual({ uv: [40, 30], snap: corner, hint: 'corner of the cut' })
  })

  it('leaves a corner 12 px away', () => {
    expect(snapAt([corner], [41.2, 30], K, false)).toBeNull()
    expect(SNAP_PX).toBe(10)
  })

  it('takes nothing with Ctrl held, a corner on the pointer too', () => {
    expect(snapAt([corner], [40, 30], K, true)).toBeNull()
  })

  it('measures in pixels: a corner 0.8 mm away is far at 100 px to the millimetre and near at 10', () => {
    expect(snapAt([corner], [40.8, 30], 100, false)).toBeNull()
    expect(snapAt([corner], [40.08, 30], 100, false)).not.toBeNull()
  })

  it('takes the nearest of several', () => {
    const near: PlaneSnap = { kind: 'corner', uv: [40.3, 30], part: 'block' }
    expect(snapAt([corner, near], [40.25, 30], K, false)?.snap).toBe(near)
  })

  it('says a hole centre by its part, its edge and its diameter', () => {
    expect(snapAt([centre], [20, 15], K, false)?.hint).toBe('hole centre head/E14 ⌀16')
    expect(snapAt([{ ...centre, edge: undefined } as PlaneSnap], [20, 15], K, false)?.hint).toBe('hole centre of head ⌀16')
  })

  it('says a vertex by its ref, and a projected one so', () => {
    expect(snapAt([vertex], [0, 0.1], K, false)?.hint).toBe('vertex block/V3')
    expect(snapAt([{ ...vertex, projected: true }], [0, 0.1], K, false)?.hint).toBe('vertex block/V3 (projected)')
  })

  it('gives a corner the point that a vertex of the same place has, and a vertex in the plane the one that is projected', () => {
    const same: PlaneSnap = { kind: 'vertex', uv: [40, 30], part: 'block', ref: 'block/V1' }
    expect(snapAt([same, corner], [40, 30], K, false)?.snap).toBe(corner)
    const projected: PlaneSnap = { kind: 'vertex', uv: [40, 30], part: 'block', ref: 'block/V2', projected: true }
    expect(snapAt([projected, same], [40, 30], K, false)?.snap).toBe(same)
  })

  it('takes nothing from no points, or from a pointer that is not a number', () => {
    expect(snapAt([], [1, 1], K, false)).toBeNull()
    expect(snapAt([corner], [Number.NaN, 0], K, false)).toBeNull()
  })

  it('diameters are told to four figures at most', () => {
    expect(snapAt([{ ...centre, radius: 8.123456 }], [20, 15], K, false)?.hint).toBe('hole centre head/E14 ⌀16.25')
  })
})
