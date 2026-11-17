import { describe, expect, it } from 'vitest'
import { viewPlane } from '../renderer/tools/planes'
import type { Vec3 } from './marks'
import { axesOfNormal, faceLabel, mainPlaneFrame } from './planes'

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

describe('a main plane', () => {
  it('is the plane the window makes of a view along its axis, label and axes', () => {
    const through: Vec3 = [3, 40, 7]
    // Front (looking along +Y), top (looking down) and right (looking along -X).
    const cameras = {
      XZ: { position: [3, -100, 7] as Vec3, target: through, up: [0, 0, 1] as Vec3 },
      XY: { position: [3, 40, 107] as Vec3, target: through, up: [0, 1, 0] as Vec3 },
      YZ: { position: [103, 40, 7] as Vec3, target: through, up: [0, 0, 1] as Vec3 }
    }
    for (const axis of ['XY', 'XZ', 'YZ'] as const) {
      const seen = viewPlane(cameras[axis], through)
      const fixed = { XY: 2, XZ: 1, YZ: 0 }[axis]
      const mine = mainPlaneFrame(axis, through[fixed])
      expect(mine.label, axis).toBe(seen.label)
      expect(mine.x, axis).toEqual(seen.x)
      expect(mine.y, axis).toEqual(seen.y)
      const origin = [0, 0, 0] as Vec3
      origin[fixed] = through[fixed]
      expect(mine.origin, axis).toEqual(origin)
    }
  })

  it('says an offset of zero as 0.0, and its axes make the right-handed frame', () => {
    expect(mainPlaneFrame('XZ', 0).label).toBe('XZ at y = 0.0 (u = +X, v = +Z)')
    expect(mainPlaneFrame('XZ', -0).origin).toEqual([0, 0, 0])
    expect(cross(mainPlaneFrame('YZ', 5).x, mainPlaneFrame('YZ', 5).y)).toEqual([1, 0, 0])
  })
})

describe('the axes of a normal', () => {
  it('are the projection of +X, or of +Y for a normal along X, with x × y the normal', () => {
    for (const normal of [[0, 0, 1], [0, 0, -2], [1, 0, 0], [-1, 0, 0], [0, 3, 4], [1, 1, 1]] as Vec3[]) {
      const axes = axesOfNormal(normal)!
      expect(Math.hypot(...axes.x)).toBeCloseTo(1, 12)
      expect(Math.hypot(...axes.y)).toBeCloseTo(1, 12)
      expect(axes.x[0] * axes.normal[0] + axes.x[1] * axes.normal[1] + axes.x[2] * axes.normal[2]).toBeCloseTo(0, 12)
      cross(axes.x, axes.y).forEach((c, i) => expect(c).toBeCloseTo(axes.normal[i], 12))
    }
    expect(axesOfNormal([0, 0, 1])!.x).toEqual([1, 0, 0])
    expect(axesOfNormal([1, 0, 0])!.x).toEqual([0, 1, 0])
  })

  it('are none for a normal that is zero or not finite', () => {
    expect(axesOfNormal([0, 0, 0])).toBeNull()
    expect(axesOfNormal([NaN, 0, 1])).toBeNull()
  })
})

describe('faceLabel', () => {
  it('names the face, the offset in mm and the axes', () => {
    expect(faceLabel('block/F31', 12, [1, 0, 0], [0, 1, 0])).toBe('plane through block/F31 offset 12 mm (u = +X, v = +Y)')
    expect(faceLabel('block/F31', -0.12345, [1, 0, 0], [0, 0.6, 0.8])).toBe('plane through block/F31 offset -0.123 mm (u = +X, v = [0, 0.6, 0.8])')
  })
})
