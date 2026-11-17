import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../shared/marks'
import { viewPlane } from '../planes'
import { facePlane, fromPlane, mainPlane, pointPlane, toPlane, withOffset } from './planes'

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

describe('a main plane', () => {
  it('has the frame and the label of the plane a view along its axis gives', () => {
    const through: Vec3 = [3, 40, 7]
    const seen = viewPlane({ position: [3, -100, 7], target: through, up: [0, 0, 1] }, through)
    const mine = mainPlane('XZ', 40, through)
    expect(mine.label).toBe('XZ at y = 40.0 (u = +X, v = +Z)')
    expect(mine.label).toBe(seen.label)
    expect(mine.x).toEqual(seen.x)
    expect(mine.y).toEqual(seen.y)
    expect(mine.from).toEqual({ kind: 'main', axis: 'XZ', offset: 40 })
  })

  it('goes through the point it is made around, on the axis it is across at its offset', () => {
    expect(mainPlane('XZ', 40, [3, 99, 7]).origin).toEqual([3, 40, 7])
    expect(mainPlane('XY', -5, [3, 9, 7]).origin).toEqual([3, 9, -5])
    expect(mainPlane('YZ', 0, [3, 9, 7]).origin).toEqual([0, 9, 7])
  })
})

describe('a plane through a face', () => {
  it('lies the offset along the normal from the face centre, and says which face and which build', () => {
    const plane = facePlane('block/F31', [10, 20, 30], [0, 0, 1], 12, 38)
    expect(plane?.origin).toEqual([10, 20, 42])
    expect(plane?.from).toEqual({ kind: 'face', ref: 'block/F31', offset: 12, revision: 38 })
    expect(plane?.label).toBe('plane through block/F31 offset 12 mm (u = +X, v = +Y)')
  })

  it('is a right-handed frame whose normal is the one given, for a slanted face', () => {
    const n: Vec3 = [0, 0.6, 0.8]
    const plane = facePlane('block/F2', [0, 0, 0], n, 0, 1)!
    const normal = cross(plane.x, plane.y)
    for (let i = 0; i < 3; i++) expect(normal[i]).toBeCloseTo(n[i])
    expect(dot(plane.x, plane.y)).toBeCloseTo(0)
  })

  it('is none for a normal that has no length', () => {
    expect(facePlane('block/F2', [0, 0, 0], [0, 0, 0], 0, 1)).toBeNull()
  })
})

describe('a plane through a point', () => {
  it('with an offset of 12 mm lies 12 mm along the normal from the point', () => {
    const plane = pointPlane([5, 6, 7], [0, 0, 1], 12)!
    expect(plane.origin).toEqual([5, 6, 19])
    expect(plane.from).toEqual({ kind: 'point', point: [5, 6, 7], normal: [0, 0, 1], offset: 12 })
    // The point itself is 12 mm from the plane, along its normal.
    expect(dot([0, 0, 1], [plane.origin[0] - 5, plane.origin[1] - 6, plane.origin[2] - 7])).toBeCloseTo(12)
  })

  it('takes the normal as it comes, of any length', () => {
    expect(pointPlane([0, 0, 0], [0, 0, 5], 1)!.origin).toEqual([0, 0, 1])
  })
})

describe('withOffset', () => {
  it('moves a plane along its normal to the new offset, and says so in its label and how it was made', () => {
    const base = facePlane('block/F31', [10, 20, 30], [0, 0, 1], 12, 38)!
    const moved = withOffset(base, 20)
    expect(moved.origin).toEqual([10, 20, 50])
    expect(moved.from).toEqual({ kind: 'face', ref: 'block/F31', offset: 20, revision: 38 })
    expect(moved.label).toBe('plane through block/F31 offset 20 mm (u = +X, v = +Y)')
  })

  it('moves a main plane across its axis, and keeps its other coordinates', () => {
    const moved = withOffset(mainPlane('XZ', 40, [3, 0, 7]), 55)
    expect(moved.origin).toEqual([3, 55, 7])
    expect(moved.label).toBe('XZ at y = 55.0 (u = +X, v = +Z)')
    expect(moved.from).toEqual({ kind: 'main', axis: 'XZ', offset: 55 })
  })

  it('moves a plane through a point, which keeps its point', () => {
    const moved = withOffset(pointPlane([5, 6, 7], [0, 0, 1], 0)!, 3)
    expect(moved.origin).toEqual([5, 6, 10])
    expect(moved.from).toEqual({ kind: 'point', point: [5, 6, 7], normal: [0, 0, 1], offset: 3 })
  })

  it('keeps what else a plane has, its number', () => {
    expect(withOffset({ ...mainPlane('XY', 0, [0, 0, 0]), id: 4 }, 1).id).toBe(4)
  })
})

describe('toPlane and fromPlane', () => {
  it('turn a point of the object frame to the two axes of the plane and back', () => {
    const plane = mainPlane('XZ', 40, [0, 0, 0])
    expect(toPlane(plane, [12, 40, -3])).toEqual([12, -3])
    expect(fromPlane(plane, [12, -3])).toEqual([12, 40, -3])
  })

  it('drop what is off the plane', () => {
    const plane = mainPlane('XZ', 40, [0, 0, 0])
    expect(toPlane(plane, [12, 99, -3])).toEqual([12, -3])
  })

  it('are each other\'s inverse on a slanted plane', () => {
    const plane = facePlane('block/F2', [1, 2, 3], [0, 0.6, 0.8], 5, 1)!
    const [u, v] = toPlane(plane, fromPlane(plane, [7, -4]))
    expect(u).toBeCloseTo(7)
    expect(v).toBeCloseTo(-4)
  })
})
