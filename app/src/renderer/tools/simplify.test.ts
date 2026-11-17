import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../shared/marks'
import { simplify } from './simplify'

describe('simplify', () => {
  it('keeps the ends and removes the points on the line between them', () => {
    expect(simplify<[number, number]>([[0, 0], [1, 0], [2, 0.05], [3, 0], [10, 0]], 0.2, 400)).toEqual([[0, 0], [10, 0]])
  })

  it('keeps a point that is further off the line than the tolerance', () => {
    expect(simplify<[number, number]>([[0, 0], [5, 0.1], [5, 3], [7, 3.1], [10, 3]], 0.2, 400)).toEqual([[0, 0], [5, 0.1], [5, 3], [10, 3]])
  })

  it('works on points in space', () => {
    const points: Vec3[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [2, 2, 8], [2, 2, 9]]
    expect(simplify(points, 0.2, 400)).toEqual([[0, 0, 0], [2, 2, 2], [2, 2, 9]])
  })

  it('never gives more than the most asked for, and still keeps the ends', () => {
    // A zigzag: no point of it is within the tolerance of its neighbours' line.
    const points = Array.from({ length: 3000 }, (_, i): [number, number] => [i, i % 2 === 0 ? 0 : 5])
    const kept = simplify(points, 0.2, 400)
    expect(kept.length).toBeLessThanOrEqual(400)
    expect(kept.length).toBeGreaterThan(300)
    expect(kept[0]).toEqual([0, 0])
    expect(kept.at(-1)).toEqual([2999, 5])
    // Thinned evenly: in the order drawn, with no long gap.
    const xs = kept.map((p) => p[0])
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(Math.max(...xs.slice(1).map((x, i) => x - xs[i]))).toBeLessThanOrEqual(9)
  })

  it('leaves one point, or two, or a closed loop, as they are', () => {
    expect(simplify<[number, number]>([[1, 2]], 0.2, 400)).toEqual([[1, 2]])
    expect(simplify<[number, number]>([[1, 2], [1, 2]], 0.2, 400)).toEqual([[1, 2], [1, 2]])
    expect(simplify<[number, number]>([[0, 0], [10, 0], [10, 10], [0, 0]], 0.2, 400)).toEqual([[0, 0], [10, 0], [10, 10], [0, 0]])
  })
})
