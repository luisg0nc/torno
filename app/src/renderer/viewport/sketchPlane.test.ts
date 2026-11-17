import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../shared/marks'
import { facePlane, mainPlane, offsetDirection, pointPlane } from '../tools/sketch/planes'
import { HANDLE_PX, dragOffset, gridStep, handleOf, sheetOf } from './sketchPlane'

const BOX = { min: [-20, -15, -2.5] as Vec3, max: [20, 15, 22.5] as Vec3 }

describe('the sheet of a plane', () => {
  it('covers the parts as the plane sees them, with a margin, in whole steps of its grid', () => {
    const plane = mainPlane('XZ', 0, [0, 0, 0])
    const sheet = sheetOf(plane, BOX)
    // The box on the plane's u (X) and v (Z) axes: -20..20 and -2.5..22.5.
    expect(sheet.u0).toBeLessThanOrEqual(-20)
    expect(sheet.u1).toBeGreaterThanOrEqual(20)
    expect(sheet.v0).toBeLessThanOrEqual(-2.5)
    expect(sheet.v1).toBeGreaterThanOrEqual(22.5)
    for (const edge of [sheet.u0, sheet.u1, sheet.v0, sheet.v1]) expect(Math.abs(edge / sheet.step - Math.round(edge / sheet.step))).toBeLessThan(1e-9)
    // Not wildly larger than the parts.
    expect(sheet.u1 - sheet.u0).toBeLessThan(80)
  })

  it('has a step of 1, 2 or 5 times a power of ten, with twelve to thirty lines across the larger side', () => {
    expect(gridStep(40)).toBe(2)
    expect(gridStep(100)).toBe(5)
    expect(gridStep(9)).toBe(0.5)
    expect(gridStep(1000)).toBe(50)
    for (const span of [0.3, 1, 7, 33, 120, 4000]) {
      const lines = span / gridStep(span)
      expect(lines).toBeGreaterThanOrEqual(12)
      expect(lines).toBeLessThanOrEqual(30)
    }
  })

  it('is square on a box that has no extent on the plane', () => {
    const sheet = sheetOf(mainPlane('XY', 0, [0, 0, 0]), { min: [5, 5, 0], max: [5, 5, 0] })
    expect(sheet.u1 - sheet.u0).toBeGreaterThan(0)
    expect(sheet.v1 - sheet.v0).toBeGreaterThan(0)
  })

  it('puts the handle on the normal through the middle of the sheet, a number of pixels off it', () => {
    const plane = mainPlane('XY', 10, [0, 0, 0])
    const sheet = { u0: -20, u1: 40, v0: 0, v1: 20, step: 5 }
    // A pixel is a millimetre here.
    const at = handleOf(plane, sheet, 1)
    expect(at[0]).toBeCloseTo(10)
    expect(at[1]).toBeCloseTo(10)
    expect(at[2]).toBeCloseTo(10 + HANDLE_PX)
  })
})

describe('the handle of a plane', () => {
  const ray = (origin: Vec3, direction: Vec3) => ({ origin, direction })

  it('moves along the axis the offset counts on: the coordinate of a main plane, the normal of a face', () => {
    expect(offsetDirection(mainPlane('XY', 0, [0, 0, 0]))).toEqual([0, 0, 1])
    // XZ is across Y: its x × y is -Y, and its offset is the y coordinate.
    expect(offsetDirection(mainPlane('XZ', 0, [0, 0, 0]))).toEqual([0, 1, 0])
    expect(offsetDirection(mainPlane('YZ', 0, [0, 0, 0]))).toEqual([1, 0, 0])
    expect(offsetDirection(facePlane('block/F3', [0, 0, 5], [0, 0, 1], 0, 1)!)).toEqual([0, 0, 1])
    const slanted = pointPlane([0, 0, 0], [0, 0, 1], 0)!
    expect(offsetDirection(slanted)).toEqual([0, 0, 1])
  })

  it('changes the offset by the distance the pointer was dragged along the normal', () => {
    // Seen from the front (looking along +Y), a plane across Z: dragging the pointer up the screen by 7 mm moves it up 7 mm.
    const plane = mainPlane('XY', 10, [0, 0, 0])
    expect(dragOffset(plane, ray([0, -100, 10 + HANDLE_PX], [0, 1, 0]), ray([0, -100, 10 + HANDLE_PX + 7], [0, 1, 0]))).toBeCloseTo(17)
    expect(dragOffset(plane, ray([0, -100, 30], [0, 1, 0]), ray([0, -100, 25], [0, 1, 0]))).toBeCloseTo(5)
    // A drag across the normal changes nothing.
    expect(dragOffset(plane, ray([0, -100, 30], [0, 1, 0]), ray([40, -100, 30], [0, 1, 0]))).toBeCloseTo(10)
  })

  it('counts a main plane across Y by its y: a drag towards +Y raises its offset', () => {
    const plane = mainPlane('XZ', 5, [0, 0, 0])
    // Seen from above (looking along -Z): +Y is up the screen.
    expect(dragOffset(plane, ray([0, 5, 100], [0, 0, -1]), ray([0, 12, 100], [0, 0, -1]))).toBeCloseTo(12)
  })

  it('holds the offset where the view looks along the normal and a drag says nothing of it', () => {
    const plane = mainPlane('XY', 10, [0, 0, 0])
    expect(dragOffset(plane, ray([0, 0, 100], [0, 0, -1]), ray([5, 5, 100], [0, 0, -1]))).toBe(10)
  })

  it('works with the view turned, as the pointer ray meets the line of the normal', () => {
    const plane = mainPlane('XY', 0, [0, 0, 0])
    // A ray from the camera at (100, -100, 100) through two points of the normal's line (x = 0, y = 0).
    const through = (z: number) => {
      const d: Vec3 = [-100, 100, z - 100]
      const l = Math.hypot(...d)
      return ray([100, -100, 100], [d[0] / l, d[1] / l, d[2] / l])
    }
    expect(dragOffset(plane, through(4), through(19))).toBeCloseTo(15)
  })
})
