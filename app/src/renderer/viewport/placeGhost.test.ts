import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../shared/marks'
import { faceFrame, haloReach, onFace } from './placeGhost'

const close = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe('faceFrame', () => {
  it('puts the part\'s Z along the normal and its X along the world X on a face that faces up', () => {
    const f = faceFrame([0, 0, 1])
    close(f.z, [0, 0, 1])
    close(f.x, [1, 0, 0])
    close(f.y, [0, 1, 0])
  })

  it('takes the projection of the world X on a tilted face, and is right-handed and orthonormal', () => {
    const n: Vec3 = [0, Math.SQRT1_2, Math.SQRT1_2]
    const f = faceFrame(n)
    close(f.z, n)
    close(f.x, [1, 0, 0])
    expect(dot(f.x, f.z)).toBeCloseTo(0, 9)
    expect(dot(f.y, f.z)).toBeCloseTo(0, 9)
    expect(dot(f.x, f.y)).toBeCloseTo(0, 9)
    // y = z x x
    close(f.y, [0, Math.SQRT1_2, -Math.SQRT1_2])
  })

  it('falls back to the world Y on a face that faces along X', () => {
    const f = faceFrame([1, 0, 0])
    close(f.z, [1, 0, 0])
    close(f.x, [0, 1, 0])
    close(f.y, [0, 0, 1])
  })

  it('handles a bottom face and a normal that is not of length one', () => {
    const f = faceFrame([0, 0, -4])
    close(f.z, [0, 0, -1])
    close(f.x, [1, 0, 0])
    close(f.y, [0, -1, 0])
  })

  it('has a frame for no normal at all', () => {
    close(faceFrame([0, 0, 0]).z, [0, 0, 1])
  })
})

describe('onFace', () => {
  it('lays the outline in the face\'s plane about the point', () => {
    const f = faceFrame([0, 0, 1])
    const out = onFace([[1, 2], [-1, 0]], f, [10, 20, 5])
    close(out[0], [11, 22, 5])
    close(out[1], [9, 20, 5])
  })

  it('follows a face along X', () => {
    const f = faceFrame([1, 0, 0])
    const out = onFace([[2, 3]], f, [0, 0, 0])
    // part x -> world Y, part y -> world Z
    close(out[0], [0, 2, 3])
  })
})

describe('haloReach', () => {
  it('is the farthest point of the outlines from the origin', () => {
    expect(haloReach([{ points: [[3, 4], [0, 1]] }, { points: [[-1, 0]] }])).toBeCloseTo(5, 9)
    expect(haloReach([])).toBe(0)
  })
})
