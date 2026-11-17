import { describe, expect, it, vi } from 'vitest'
import { MAX_STROKE_POINTS } from '../../../shared/marks'
import type { PlaneSnap } from '../../../shared/tracings'
import { type InkStroke, InkTool, inkSnap, inkPlane } from './inkTool'

/** Ten pixels to the millimetre. */
const K = 10
const setup = () => {
  const made: InkStroke[] = []
  const changed = vi.fn()
  const tool = new InkTool((stroke) => made.push(stroke), changed)
  return { tool, made, changed }
}
const at = (u: number, v: number, snap?: PlaneSnap) => ({ uv: [u, v] as [number, number], ...(snap ? { snap } : {}) })
const corner: PlaneSnap = { kind: 'corner', uv: [10, 0], part: 'block' }
const centre: PlaneSnap = { kind: 'centre', uv: [5, 5], radius: 3, part: 'block', edge: 'E14' }
const vertex: PlaneSnap = { kind: 'vertex', uv: [0, 10], part: 'block', ref: 'block/V3' }
const projected: PlaneSnap = { kind: 'vertex', uv: [0, 0], part: 'block', ref: 'block/V1', projected: true }

describe('the freehand pen', () => {
  it('draws a stroke from the press to the release, thinned to a couple of pixels, rough by nature', () => {
    const { tool, made } = setup()
    expect(tool.pen).toBe('free')
    tool.press(at(0, 0), K)
    tool.move(at(0.05, 0), K)
    tool.move(at(1, 0), K)
    tool.move(at(1, 1), K)
    tool.release(at(2, 1), K)
    expect(made).toEqual([{ pen: 'free', points2d: [[0, 0], [1, 0], [1, 1], [2, 1]] }])
    expect(tool.active).toBe(false)
  })

  it('draws nothing of a press that did not move', () => {
    const { tool, made } = setup()
    tool.press(at(3, 3), K)
    tool.release(at(3.01, 3), K)
    expect(made).toEqual([])
  })

  it('keeps a stroke to what a stroke holds, whole from its first point to its last', () => {
    const { tool, made } = setup()
    tool.press(at(0, 0), K)
    for (let i = 1; i < 1000; i++) tool.move(at(i, (i % 7) * 0.3), K)
    tool.release(at(1000, 0), K)
    expect(made).toHaveLength(1)
    expect(made[0].points2d).toHaveLength(MAX_STROKE_POINTS)
    expect(made[0].points2d[0]).toEqual([0, 0])
    expect(made[0].points2d.at(-1)).toEqual([1000, 0])
  })

  it('takes the points of the first and the last as snapped, and no point between', () => {
    const { tool, made } = setup()
    tool.press(at(10, 0, corner), K)
    tool.move(at(5, 5, centre), K)
    tool.release(at(0, 10, vertex), K)
    expect(made[0].points2d).toEqual([[10, 0], [5, 5], [0, 10]])
    expect(made[0].snaps).toEqual([{ i: 2, vertex: 'block/V3' }])
  })

  it('gives up what is under way with Esc', () => {
    const { tool, made } = setup()
    tool.press(at(0, 0), K)
    tool.move(at(3, 0), K)
    expect(tool.cancel()).toBe(true)
    tool.release(at(5, 0), K)
    expect(made).toEqual([])
    expect(tool.cancel()).toBe(false)
  })
})

describe('the line pen', () => {
  it('draws a line pressed and dragged', () => {
    const { tool, made } = setup()
    tool.setPen('line')
    tool.press(at(0, 0), K)
    tool.release(at(10, 5), K)
    expect(made).toEqual([{ pen: 'line', points2d: [[0, 0], [10, 5]] }])
  })

  it('draws a line clicked twice, and the first click waits', () => {
    const { tool, made } = setup()
    tool.setPen('line')
    tool.press(at(0, 0), K)
    tool.release(at(0.1, 0), K)
    expect(tool.active).toBe(true)
    expect(made).toEqual([])
    tool.press(at(4, 4), K)
    tool.release(at(4, 4), K)
    expect(made).toEqual([{ pen: 'line', points2d: [[0, 0], [4, 4]] }])
    expect(tool.active).toBe(false)
  })

  it('snaps both ends, to a centre with the edge and radius it is of, and to a corner with no ref at all', () => {
    const { tool, made } = setup()
    tool.setPen('line')
    tool.press(at(5, 5, centre), K)
    tool.release(at(10, 0, corner), K)
    expect(made[0].points2d).toEqual([[5, 5], [10, 0]])
    expect(made[0].snaps).toEqual([{ i: 0, centre: 'block/E14', radius: 3 }])
  })
})

describe('the point to point pen', () => {
  it('takes a click for each point and ends with Enter, with the snap of each point', () => {
    const { tool, made } = setup()
    tool.setPen('points')
    tool.press(at(0, 0), K)
    tool.release(at(0, 0), K)
    tool.press(at(0, 10, vertex), K)
    tool.release(at(0, 10), K)
    tool.press(at(0, 0, projected), K)
    tool.release(at(0, 0), K)
    expect(made).toEqual([])
    expect(tool.end()).toBe(true)
    expect(made).toEqual([{ pen: 'points', points2d: [[0, 0], [0, 10], [0, 0]], snaps: [{ i: 1, vertex: 'block/V3' }, { i: 2, vertex: 'block/V1', projected: true }] }])
  })

  it('has nothing to end with one point, takes the last back with Backspace, and does not take a double click twice', () => {
    const { tool, made } = setup()
    tool.setPen('points')
    tool.press(at(1, 1), K)
    tool.release(at(1, 1), K)
    tool.press(at(1.02, 1), K)
    tool.release(at(1.02, 1), K)
    expect(tool.draft).toEqual([[1, 1]])
    expect(tool.end()).toBe(false)
    tool.press(at(5, 1), K)
    tool.release(at(5, 1), K)
    expect(tool.back()).toBe(true)
    expect(tool.draft).toEqual([[1, 1]])
    expect(tool.back()).toBe(true)
    expect(tool.back()).toBe(false)
    expect(made).toEqual([])
  })

  it('ends by itself at the most points a stroke holds', () => {
    const { tool, made } = setup()
    tool.setPen('points')
    for (let i = 0; i < MAX_STROKE_POINTS; i++) {
      tool.press(at(i, 0), K)
      tool.release(at(i, 0), K)
    }
    expect(made).toHaveLength(1)
    expect(made[0].points2d).toHaveLength(MAX_STROKE_POINTS)
  })
})

describe('the pens', () => {
  it('go round with the key, and a change of pen gives up the stroke under way', () => {
    const { tool } = setup()
    expect(tool.cycle()).toBe('line')
    expect(tool.cycle()).toBe('points')
    expect(tool.cycle()).toBe('free')
    tool.setPen('points')
    tool.press(at(0, 0), K)
    tool.release(at(0, 0), K)
    expect(tool.active).toBe(true)
    tool.setPen('free')
    expect(tool.active).toBe(false)
  })

  it('draw what is under way as a dashed path to the pointer, in the sheet\'s millimetres', () => {
    const { tool } = setup()
    tool.setPen('points')
    tool.press(at(0, 0), K)
    tool.release(at(0, 0), K)
    tool.press(at(10, 5), K)
    tool.release(at(10, 5), K)
    const up = tool.elements([20, 5], true, K)
    expect(up).toContain('d="M0 0 L10 5 L20 5"')
    expect(tool.elements([20, 5], false, K)).toContain('d="M0 0 L10 -5 L20 -5"')
    tool.cancel()
    expect(tool.elements([20, 5], true, K)).toBe('')
  })
})

describe('what a snap says to main', () => {
  it('is a vertex by its ref, a centre by its edge and radius, a corner by nothing, and says projected', () => {
    expect(inkSnap(vertex, 3)).toEqual({ i: 3, vertex: 'block/V3' })
    expect(inkSnap(projected, 0)).toEqual({ i: 0, vertex: 'block/V1', projected: true })
    expect(inkSnap(centre, 1)).toEqual({ i: 1, centre: 'block/E14', radius: 3 })
    expect(inkSnap({ ...centre, edge: undefined } as PlaneSnap, 1)).toBeNull()
    expect(inkSnap(corner, 1)).toBeNull()
  })
})

describe('the plane of the ink', () => {
  it('is the tracing\'s own frame, made from it', () => {
    const tracing = { id: 'T2', plane: { origin: [1, 2, 3], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 3.0', from: { kind: 'main', axis: 'XY', offset: 3 } } } as never
    expect(inkPlane(tracing)).toEqual({ id: 1, origin: [1, 2, 3], x: [1, 0, 0], y: [0, 1, 0], label: 'XY at z = 3.0', from: { kind: 'tracing', tracing: 'T2' } })
  })
})
