import { describe, expect, it } from 'vitest'
import type { SketchPlane, SketchStroke, Vec3 } from '../../../shared/marks'
import { strokeAt } from './hit'
import { mainPlane } from './planes'

// From the front: x to the right, z up, a pixel is a millimetre.
const screen = (p: Vec3): [number, number] => [p[0], -p[2]]
const planes: SketchPlane[] = [{ id: 1, ...mainPlane('XZ', 0, [0, 0, 0]) }]
const strokes: SketchStroke[] = [
  { id: 'k1', plane: 1, pen: 'line', points2d: [[0, 0], [50, 0]], revision: 1 },
  { id: 'k2', plane: 1, pen: 'points', points2d: [[10, 20], [10, 40], [30, 40]], revision: 1 },
  { id: 'k3', pen: 'free', points: [[0, 5, 60], [40, -5, 60]], revision: 1 }
]

describe('the stroke under the pointer', () => {
  it('is the stroke a pointer within a few pixels of its line is on, for a line, a polyline and a stroke on the surface', () => {
    expect(strokeAt({ planes, strokes }, screen, [25, 3])).toBe(0)
    expect(strokeAt({ planes, strokes }, screen, [10, -30])).toBe(1)
    expect(strokeAt({ planes, strokes }, screen, [20, -40.5])).toBe(1)
    expect(strokeAt({ planes, strokes }, screen, [20, -62])).toBe(2)
  })

  it('is none beyond the radius, past the ends, or with no strokes', () => {
    expect(strokeAt({ planes, strokes }, screen, [25, 12])).toBeNull()
    expect(strokeAt({ planes, strokes }, screen, [70, 0])).toBeNull()
    expect(strokeAt({ planes, strokes: [] }, screen, [25, 0])).toBeNull()
  })

  it('is the nearest of those within the radius, and the later one when they are as near', () => {
    const near: SketchStroke[] = [{ id: 'k1', plane: 1, pen: 'line', points2d: [[0, 0], [50, 0]], revision: 1 }, { id: 'k2', plane: 1, pen: 'line', points2d: [[0, 4], [50, 4]], revision: 1 }]
    expect(strokeAt({ planes, strokes: near }, screen, [25, -1])).toBe(0)
    expect(strokeAt({ planes, strokes: near }, screen, [25, -3])).toBe(1)
    expect(strokeAt({ planes, strokes: [near[0], near[0]] }, screen, [25, 0])).toBe(1)
  })

  it('is on the point of a stroke of one point', () => {
    const dot: SketchStroke[] = [{ id: 'k1', plane: 1, pen: 'points', points2d: [[5, 5]], revision: 1 }]
    expect(strokeAt({ planes, strokes: dot }, screen, [6, -6])).toBe(0)
  })
})
