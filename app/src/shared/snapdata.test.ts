import { describe, expect, it } from 'vitest'
import type { Part } from './scene'
import { circleOf, nearestOnCircle, nearestOnSegment, snapOf, vertexAt, type SnapData } from './snapdata'

// Three vertices, and two circles on edges 2 and 5: the kernel's layout (`points`, `circles`).
const data: SnapData = {
  points: new Float32Array([0, 0, 0, 20, 0, 0, 20, 20, 10]),
  circles: new Float32Array([2, 10, 10, 0, 0, 0, 1, 4, 5, 10, 10, 10, 0, 0, -1, 2.5])
}

describe('vertexAt', () => {
  it('reads the vertex V<i>, counting from 0', () => {
    expect(vertexAt(data, 0)).toEqual([0, 0, 0])
    expect(vertexAt(data, 2)).toEqual([20, 20, 10])
  })

  it('is null past the last, below the first, or for a number that is no index', () => {
    expect(vertexAt(data, 3)).toBeNull()
    expect(vertexAt(data, -1)).toBeNull()
    expect(vertexAt(data, 0.5)).toBeNull()
    expect(vertexAt(data, NaN)).toBeNull()
  })
})

describe('circleOf', () => {
  it('finds a circle by the index of its edge, not by its place among the circles', () => {
    expect(circleOf(data, 2)).toEqual({ centre: [10, 10, 0], axis: [0, 0, 1], radius: 4 })
    expect(circleOf(data, 5)).toEqual({ centre: [10, 10, 10], axis: [0, 0, -1], radius: 2.5 })
  })

  it('is null for an edge that is no circle', () => {
    expect(circleOf(data, 0)).toBeNull()
    expect(circleOf(data, 3)).toBeNull()
  })
})

describe('with no snap data (a part of an older kernel)', () => {
  it('has no vertex and no circle', () => {
    const none: SnapData = { points: new Float32Array(0), circles: new Float32Array(0) }
    expect(vertexAt(none, 0)).toBeNull()
    expect(circleOf(none, 0)).toBeNull()
  })
})

describe('snapOf', () => {
  const part = (mesh: object) => ({ mesh }) as unknown as Part

  it('reads both buffers out of the blob, and copies them', () => {
    const blob = new Float32Array([1, 2, 3, 7, 0, 0, 0, 0, 0, 1, 3]).buffer
    const got = snapOf(part({ points: { offset: 0, length: 12 }, circles: { offset: 12, length: 32 } }), blob)!
    new Uint8Array(blob).fill(0)
    expect(Array.from(got.points)).toEqual([1, 2, 3])
    expect(circleOf(got, 7)).toEqual({ centre: [0, 0, 0], axis: [0, 0, 1], radius: 3 })
  })

  it('is undefined when the kernel sent neither', () => {
    expect(snapOf(part({}), new ArrayBuffer(0))).toBeUndefined()
  })
})

describe('nearestOnSegment', () => {
  it('is the foot of the perpendicular, held to the ends', () => {
    expect(nearestOnSegment([0, 0, 0], [10, 0, 0], [4, 3, 2])).toEqual([4, 0, 0])
    expect(nearestOnSegment([0, 0, 0], [10, 0, 0], [-4, 3, 2])).toEqual([0, 0, 0])
    expect(nearestOnSegment([0, 0, 0], [10, 0, 0], [14, 3, 2])).toEqual([10, 0, 0])
  })

  it('is the one end of a segment that has no length', () => {
    expect(nearestOnSegment([1, 2, 3], [1, 2, 3], [9, 9, 9])).toEqual([1, 2, 3])
  })
})

describe('nearestOnCircle', () => {
  it('is the point of the circle on the line from the centre to the point seen along the axis', () => {
    const p = nearestOnCircle([10, 10, 0], [0, 0, 1], 4, [20, 10, 7])
    expect(p[0]).toBeCloseTo(14)
    expect(p[1]).toBeCloseTo(10)
    expect(p[2]).toBeCloseTo(0)
  })

  it('is some point of the circle over its centre', () => {
    const p = nearestOnCircle([0, 0, 0], [0, 0, 1], 4, [0, 0, 9])
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(4)
    expect(p[2]).toBeCloseTo(0)
  })
})
