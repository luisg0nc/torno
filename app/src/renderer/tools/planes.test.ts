import { describe, expect, it } from 'vitest'
import type { Camera } from '../../shared/view'
import { fromPlane, planeName, toPlane, viewPlane } from './planes'

// From the front: the camera is on -Y and looks along +Y. A pixel is a millimetre.
const FRONT: Camera = { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }

describe('viewPlane', () => {
  it('names the plane of the front view through a point: XZ at its y', () => {
    const plane = viewPlane({ ...FRONT, position: [0, -100, 0], target: [0, 0, 0] }, [0, 40, 0])
    expect(plane).toEqual({ origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0 (u = +X, v = +Z)' })
  })

  it('has the view’s right and up as its axes, whichever way the view looks', () => {
    // From the right: looking along -X, +Y is to the right.
    expect(viewPlane({ ...FRONT, position: [100, 0, 0] }, [12.34, 0, 5])).toEqual({ origin: [12.34, 0, 5], x: [0, 1, 0], y: [0, 0, 1], label: 'YZ at x = 12.3 (u = +Y, v = +Z)' })
    // From above, +Y up on screen. The viewport leans this camera by a hair: the axes come out exact all the same.
    expect(viewPlane({ ...FRONT, position: [0, -0.001, 100], up: [0, 1, 0.00001] }, [1, 2, -0.04])).toEqual({ origin: [1, 2, -0.04], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 0.0 (u = +X, v = +Y)' })
    // From the back: +X runs to the left, and the plane says so in its x.
    expect(viewPlane({ ...FRONT, position: [0, 100, 0] }, [0, 0, 0])).toMatchObject({ x: [-1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0 (u = -X, v = +Z)' })
  })

  it('says which way its two axes run, so that the same plane seen from the other side is not the same label: a profile is never read mirrored', () => {
    const from = (position: [number, number, number], up: [number, number, number] = [0, 0, 1]) => viewPlane({ ...FRONT, position, up }, [1, 2, 3])
    // Front and back.
    expect(from([0, -100, 0])).toMatchObject({ x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 2.0 (u = +X, v = +Z)' })
    expect(from([0, 100, 0])).toMatchObject({ x: [-1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 2.0 (u = -X, v = +Z)' })
    // Right and left.
    expect(from([100, 0, 0])).toMatchObject({ x: [0, 1, 0], y: [0, 0, 1], label: 'YZ at x = 1.0 (u = +Y, v = +Z)' })
    expect(from([-100, 0, 0])).toMatchObject({ x: [0, -1, 0], y: [0, 0, 1], label: 'YZ at x = 1.0 (u = -Y, v = +Z)' })
    // Top and bottom.
    expect(from([0, 0, 100], [0, 1, 0])).toMatchObject({ x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 3.0 (u = +X, v = +Y)' })
    expect(from([0, 0, -100], [0, -1, 0])).toMatchObject({ x: [1, 0, 0], y: [0, -1, 0], label: 'XY at z = 3.0 (u = +X, v = -Y)' })
    // A point drawn to the right of the origin on screen is at +u, whichever side it is seen from.
    expect(fromPlane(from([0, 100, 0]), [5, 0])).toEqual([-4, 2, 3])
    expect(fromPlane(from([-100, 0, 0]), [5, 0])).toEqual([1, -3, 3])
    expect(fromPlane(from([0, 0, -100], [0, -1, 0]), [0, 5])).toEqual([1, -3, 3])
  })

  it('names a plane seen square on but turned about the view by its axes as vectors', () => {
    const turned = viewPlane({ ...FRONT, position: [0, 0, 100], up: [Math.SQRT1_2, Math.SQRT1_2, 0] }, [0, 0, 5])
    expect(turned.label).toBe('XY at z = 5.0 (u = [0.71, -0.71, 0], v = [0.71, 0.71, 0])')
    expect(planeName(turned.label)).toBe('XY at z = 5.0')
    expect(planeName('view plane (u = [1, 0.01, 0], v = +Z)')).toBe('view plane')
  })

  it('is only "view plane" when the view is more than half a degree off every axis', () => {
    const off = Math.tan((0.6 * Math.PI) / 180) * 100
    const plane = viewPlane({ ...FRONT, position: [off, -100, 0] }, [0, 40, 0])
    // An axis that is exactly a principal one is named; the other is given as its numbers.
    expect(plane.label).toBe('view plane (u = [1, 0.01, 0], v = +Z)')
    expect(Math.hypot(...plane.x)).toBeCloseTo(1, 9)
    expect(plane.y).toEqual([0, 0, 1])
    const near = Math.tan((0.4 * Math.PI) / 180) * 100
    expect(viewPlane({ ...FRONT, position: [near, -100, 0] }, [0, 40, 0]).label).toBe('XZ at y = 40.0 (u = +X, v = +Z)')
  })

  it('takes points to its own two axes and back', () => {
    const plane = viewPlane({ ...FRONT, position: [60, -80, 50] }, [3, 4, 5])
    for (const uv of [[0, 0], [12.5, -7], [-30, 41.25]] as [number, number][]) {
      const back = toPlane(plane, fromPlane(plane, uv))
      expect(back[0]).toBeCloseTo(uv[0], 9)
      expect(back[1]).toBeCloseTo(uv[1], 9)
    }
    expect(fromPlane(viewPlane(FRONT, [0, 40, 0]), [10, 20])).toEqual([10, 40, 20])
    expect(toPlane(viewPlane(FRONT, [0, 40, 0]), [10, 40, 20])).toEqual([10, 20])
  })
})
