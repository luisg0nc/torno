import { describe, expect, it } from 'vitest'
import { MAX_STROKE_POINTS } from '../../../shared/marks'
import type { Snap } from './snap'
import { PenState, type PenStroke } from './pens'

type Pt = [number, number]
function pen(kind: 'free' | 'line' | 'points') {
  const strokes: PenStroke<Pt>[] = []
  const state = new PenState<Pt>(kind, (s) => strokes.push(s))
  return { state, strokes }
}
const vertex = (n: number): { snap: Snap; projected: boolean } => ({ snap: { kind: 'vertex', ref: `block/V${n}`, point: [0, 0, 0] }, projected: false })

describe('point to point', () => {
  it('makes a stroke of three points from three clicks and Enter', () => {
    const { state, strokes } = pen('points')
    state.click([0, 0])
    state.click([10, 0])
    state.click([10, 10])
    expect(strokes).toHaveLength(0)
    state.enter()
    expect(strokes).toEqual([{ pen: 'points', points: [[0, 0], [10, 0], [10, 10]], snaps: [] }])
  })

  it('drops the last point on Backspace', () => {
    const { state, strokes } = pen('points')
    state.click([0, 0])
    state.click([10, 0])
    state.click([10, 10])
    state.backspace()
    state.enter()
    expect(strokes[0].points).toEqual([[0, 0], [10, 0]])
  })

  it('shows the point under the pointer as the end of the segment being drawn', () => {
    const { state } = pen('points')
    state.click([0, 0])
    state.move([3, 4])
    expect(state.points).toEqual([[0, 0], [3, 4]])
    expect(state.segment).toEqual({ from: [0, 0], to: [3, 4], length: 5, angle: expect.closeTo(53.13, 1) })
  })

  it('makes a stroke of one point of a single click and Enter, and nothing of Enter alone', () => {
    const { state, strokes } = pen('points')
    state.enter()
    expect(strokes).toHaveLength(0)
    state.click([2, 3])
    state.enter()
    expect(strokes[0].points).toEqual([[2, 3]])
  })

  it('says which points snapped, and to what, by their number in the stroke', () => {
    const { state, strokes } = pen('points')
    state.click([0, 0], vertex(1))
    state.click([10, 0])
    state.click([10, 10], { snap: { kind: 'centre', ref: 'head/E14', point: [0, 0, 0], radius: 8 }, projected: true })
    state.enter()
    expect(strokes[0].snaps).toEqual([{ i: 0, vertex: 'block/V1' }, { i: 2, centre: 'head/E14', radius: 8, projected: true }])
  })

  it('takes a number typed for a segment as its length along the way the pointer points, and Enter fixes it', () => {
    const { state, strokes } = pen('points')
    state.click([0, 0])
    state.move([10, 0])
    state.typedLength(50)
    expect(state.points).toEqual([[0, 0], [50, 0]])
    state.enter()
    // Fixed: the point is a point, and the pointer is again the end of the next segment.
    expect(strokes).toHaveLength(0)
    expect(state.points).toEqual([[0, 0], [50, 0], [10, 0]])
    state.enter()
    expect(strokes[0].points).toEqual([[0, 0], [50, 0]])
  })

  it('keeps a typed length while the pointer turns, and lets go of it when it is cleared', () => {
    const { state } = pen('points')
    state.click([0, 0])
    state.move([30, 40])
    state.typedLength(100)
    expect(state.points[1][0]).toBeCloseTo(60)
    expect(state.points[1][1]).toBeCloseTo(80)
    state.move([0, 5])
    expect(state.points[1][0]).toBeCloseTo(0)
    expect(state.points[1][1]).toBeCloseTo(100)
    state.typedLength(null)
    expect(state.points[1]).toEqual([0, 5])
  })

  it('does not take more points than a stroke may have', () => {
    const { state, strokes } = pen('points')
    for (let i = 0; i < MAX_STROKE_POINTS + 20; i++) state.click([i, 0])
    state.enter()
    expect(strokes[0].points).toHaveLength(MAX_STROKE_POINTS)
  })
})

describe('line', () => {
  it('is a stroke of two points from press, drag and release', () => {
    const { state, strokes } = pen('line')
    state.down([0, 0])
    state.move([10, 0])
    state.move([30, 40])
    state.up()
    expect(strokes).toEqual([{ pen: 'line', points: [[0, 0], [30, 40]], snaps: [] }])
    expect(state.points).toEqual([])
  })

  it('is a stroke of two points from a click and a click', () => {
    const { state, strokes } = pen('line')
    state.click([0, 0], vertex(3))
    expect(strokes).toHaveLength(0)
    state.move([5, 5])
    expect(state.points).toEqual([[0, 0], [5, 5]])
    state.click([20, 5])
    expect(strokes).toEqual([{ pen: 'line', points: [[0, 0], [20, 5]], snaps: [{ i: 0, vertex: 'block/V3' }] }])
  })

  it('has the length typed for it along its direction, and Enter ends it', () => {
    const { state, strokes } = pen('line')
    state.down([0, 0])
    state.move([10, 0])
    state.typedLength(50)
    state.enter()
    expect(strokes[0].points).toEqual([[0, 0], [50, 0]])
  })

  it('drops a line that has no length', () => {
    const { state, strokes } = pen('line')
    state.click([5, 5])
    state.click([5, 5.01])
    expect(strokes).toHaveLength(0)
    expect(state.points).toEqual([])
  })

  it('is given up by Backspace before its second point', () => {
    const { state, strokes } = pen('line')
    state.click([0, 0])
    state.backspace()
    expect(state.points).toEqual([])
    expect(strokes).toHaveLength(0)
  })

  it('works in three dimensions, for a stroke on the surface', () => {
    const strokes: PenStroke<[number, number, number]>[] = []
    const state = new PenState<[number, number, number]>('line', (s) => strokes.push(s))
    state.click([0, 0, 0])
    state.move([0, 0, 4])
    state.typedLength(25)
    state.enter()
    expect(strokes[0].points).toEqual([[0, 0, 0], [0, 0, 25]])
    expect(state.segment).toBeNull()
  })
})

describe('freehand', () => {
  it('comes out with at most 400 points from a thousand samples', () => {
    const { state, strokes } = pen('free')
    state.down([0, 0])
    for (let i = 1; i < 1000; i++) state.move([i * 0.1, 5 * Math.sin(i * 0.05) + 3 * Math.sin(i * 0.9)])
    state.up()
    expect(strokes).toHaveLength(1)
    expect(strokes[0].points.length).toBeLessThanOrEqual(MAX_STROKE_POINTS)
    expect(strokes[0].points.length).toBeGreaterThan(50)
    expect(strokes[0].points[0]).toEqual([0, 0])
    expect(strokes[0].points.at(-1)![0]).toBeCloseTo(99.9)
  })

  it('is simplified by 0.2 mm: a straight run of samples is its two ends', () => {
    const { state, strokes } = pen('free')
    state.down([0, 0])
    for (let i = 1; i <= 50; i++) state.move([i, 0.05 * (i % 2)])
    state.up()
    expect(strokes[0].points).toEqual([[0, 0], [50, 0.05 * 0]])
  })

  it('drops a stroke under 0.1 mm', () => {
    const { state, strokes } = pen('free')
    state.down([4, 4])
    state.move([4.05, 4])
    state.up()
    expect(strokes).toHaveLength(0)
    state.down([4, 4])
    state.up()
    expect(strokes).toHaveLength(0)
  })

  it('keeps the snaps of the points the simplifying kept, renumbered', () => {
    const { state, strokes } = pen('free')
    state.down([0, 0], vertex(0))
    for (let i = 1; i < 30; i++) state.move([i, 0], i === 15 ? vertex(9) : undefined)
    state.move([29, 20], vertex(2))
    state.up()
    const last = strokes[0].points.length - 1
    expect(strokes[0].snaps).toEqual([{ i: 0, vertex: 'block/V0' }, { i: last, vertex: 'block/V2' }])
  })

  it('does nothing on a move without a press', () => {
    const { state, strokes } = pen('free')
    state.move([1, 1])
    state.move([20, 20])
    state.up()
    expect(strokes).toHaveLength(0)
  })
})

describe('changing pen', () => {
  it('gives up the stroke under way', () => {
    const { state, strokes } = pen('points')
    state.click([0, 0])
    state.click([5, 5])
    state.setPen('line')
    expect(state.pen).toBe('line')
    expect(state.points).toEqual([])
    state.enter()
    expect(strokes).toHaveLength(0)
  })

  it('is given up by cancel', () => {
    const { state, strokes } = pen('points')
    state.click([0, 0])
    state.cancel()
    state.enter()
    expect(strokes).toHaveLength(0)
  })
})
