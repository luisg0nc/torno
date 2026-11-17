import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../shared/marks'
import { CUBE_HALF_PX, cubeCentre, cubeFaces, faceAt } from './viewCube'

// A camera as its axes in the object frame: `right` and `up` on screen, and `forward`, the way it looks.
const FRONT = { right: [1, 0, 0] as Vec3, up: [0, 0, 1] as Vec3, forward: [0, 1, 0] as Vec3 }
const TOP = { right: [1, 0, 0] as Vec3, up: [0, 1, 0] as Vec3, forward: [0, 0, -1] as Vec3 }
const norm = (v: Vec3): Vec3 => v.map((c) => c / Math.hypot(...v)) as Vec3
// Iso: from the front, right and above.
const ISO = (() => {
  const forward = norm([-1, 1, -1])
  const right = norm([1, 1, 0])
  const up = norm([-right[1] * forward[2] + right[2] * forward[1], -right[2] * forward[0] + right[0] * forward[2], -right[0] * forward[1] + right[1] * forward[0]])
  return { right, up, forward }
})()

describe('the view cube', () => {
  it('stands in the top right corner of the view', () => {
    const [x, y] = cubeCentre(1000)
    expect(x).toBeGreaterThan(1000 - 2 * CUBE_HALF_PX - 60)
    expect(x).toBeLessThan(1000 - CUBE_HALF_PX)
    expect(y).toBeGreaterThan(CUBE_HALF_PX)
    expect(y).toBeLessThan(120)
  })

  it('shows one face from the front: XZ, the one that faces the camera', () => {
    const faces = cubeFaces(FRONT, [500, 100], CUBE_HALF_PX).filter((f) => f.facing)
    expect(faces.map((f) => f.name)).toEqual(['XZ'])
    expect(faces[0].sign).toBe(-1)
    // Square to the screen, as large as the cube.
    const xs = faces[0].polygon.map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * CUBE_HALF_PX)
  })

  it('shows XY from the top, and the other side of a plane from behind', () => {
    expect(cubeFaces(TOP, [0, 0], 20).filter((f) => f.facing).map((f) => [f.name, f.sign])).toEqual([['XY', 1]])
    expect(cubeFaces({ ...FRONT, forward: [0, -1, 0], right: [-1, 0, 0] }, [0, 0], 20).filter((f) => f.facing).map((f) => [f.name, f.sign])).toEqual([['XZ', 1]])
  })

  it('shows three faces from an iso view, one of each plane', () => {
    const faces = cubeFaces(ISO, [0, 0], 20).filter((f) => f.facing)
    expect(faces.map((f) => f.name).sort()).toEqual(['XY', 'XZ', 'YZ'])
  })

  it('says which plane a click is on, and none beside the cube or on a face turned away', () => {
    const faces = cubeFaces(FRONT, [500, 100], CUBE_HALF_PX)
    expect(faceAt(faces, [500, 100])).toBe('XZ')
    expect(faceAt(faces, [500 + CUBE_HALF_PX - 1, 100 - CUBE_HALF_PX + 1])).toBe('XZ')
    expect(faceAt(faces, [500 + CUBE_HALF_PX + 3, 100])).toBeNull()
    const iso = cubeFaces(ISO, [500, 100], CUBE_HALF_PX)
    const centres = Object.fromEntries(iso.filter((f) => f.facing).map((f) => [f.name, f.centre]))
    for (const name of ['XY', 'XZ', 'YZ'] as const) expect(faceAt(iso, centres[name])).toBe(name)
  })
})
