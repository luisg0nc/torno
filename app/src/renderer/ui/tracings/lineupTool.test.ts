import { describe, expect, it } from 'vitest'
import type { PlaneSnap } from '../../../shared/tracings'
import { barText, LineupTool, lineupSnapOf, offeredSnaps } from './lineupTool'

// The clicks of lining a photo up: the same spots on the photo and then on the tracing, in order, numbered in pairs. The tool holds the
// clicks and what they say; the view draws them and forwards the pointer.

const feed = (tool: LineupTool, n: number): void => {
  for (let i = 0; i < n; i++) {
    tool.clickPhoto([100 + 90 * i, 80 + 40 * (i % 2)])
    tool.clickTracing([20 * i, 10 * (i % 3)])
  }
}

describe('LineupTool', () => {
  it('asks for the photo first, then the tracing, and numbers the clicks in pairs', () => {
    const tool = new LineupTool()
    expect(tool.next()).toBe('photo')
    expect(tool.clickTracing([0, 0])).toBe(false)
    expect(tool.clickPhoto([10, 20])).toBe(true)
    expect(tool.next()).toBe('tracing')
    expect(tool.clickPhoto([30, 40])).toBe(false)
    expect(tool.clickTracing([5, 6])).toBe(true)
    expect(tool.next()).toBe('photo')
    tool.clickPhoto([50, 60])
    expect(tool.photo.map((_, i) => i + 1)).toEqual([1, 2])
    expect(tool.tracing.map((_, i) => i + 1)).toEqual([1])
    expect(tool.pairs()).toEqual([{ photo: [10, 20], uv: [5, 6] }])
    expect(tool.say()).toBe('Click point 2 on the tracing')
  })

  it('takes the last click away on Backspace, one at a time, whichever side it was', () => {
    const tool = new LineupTool()
    feed(tool, 2)
    tool.clickPhoto([300, 300])
    expect(tool.undo()).toBe(true)
    expect(tool.photo).toHaveLength(2)
    expect(tool.tracing).toHaveLength(2)
    expect(tool.undo()).toBe(true)
    expect(tool.tracing).toHaveLength(1)
    expect(tool.next()).toBe('tracing')
    for (let i = 0; i < 3; i++) expect(tool.undo()).toBe(true)
    expect(tool.photo).toHaveLength(0)
    expect(tool.tracing).toHaveLength(0)
    expect(tool.undo()).toBe(false)
  })

  it('stops at 8 pairs', () => {
    const tool = new LineupTool()
    feed(tool, 8)
    expect(tool.next()).toBeNull()
    expect(tool.clickPhoto([1, 1])).toBe(false)
    expect(tool.pairs()).toHaveLength(8)
  })

  it('is done at 2 pairs, and with Straighten on only from 4', () => {
    const tool = new LineupTool()
    expect(tool.canDone()).toBe(false)
    feed(tool, 1)
    expect(tool.canDone()).toBe(false)
    feed(tool, 0)
    tool.clickPhoto([400, 100])
    expect(tool.canDone()).toBe(false)
    tool.clickTracing([40, 40])
    expect(tool.canDone()).toBe(true)
    tool.setStraighten(true)
    expect(tool.canDone()).toBe(false)
    expect(tool.method()).toBe('straight')
    tool.clickPhoto([500, 100])
    tool.clickTracing([50, 50])
    expect(tool.canDone()).toBe(false)
    tool.clickPhoto([600, 300])
    tool.clickTracing([60, 20])
    expect(tool.canDone()).toBe(true)
    tool.setStraighten(false)
    expect(tool.method()).toBe('similar')
  })

  it('is not done while a click waits for its partner', () => {
    const tool = new LineupTool()
    feed(tool, 2)
    tool.clickPhoto([700, 10])
    expect(tool.canDone()).toBe(false)
    expect(tool.pairs()).toHaveLength(2)
  })

  it('straightens by default off, and keeps what was chosen for a photo lined up that way', () => {
    expect(new LineupTool().straighten).toBe(false)
    const again = LineupTool.from([{ photo: [1, 2], uv: [3, 4] }, { photo: [5, 6], uv: [7, 8] }, { photo: [9, 1], uv: [2, 5] }, { photo: [8, 8], uv: [6, 6] }], 'straight')
    expect(again.straighten).toBe(true)
    expect(again.pairs()).toHaveLength(4)
    expect(again.canDone()).toBe(true)
  })

  it('moves a click by dragging its marker, on either side, and keeps what a tracing click snapped to only until it is moved', () => {
    const tool = new LineupTool()
    tool.clickPhoto([10, 10])
    tool.clickTracing([5, 5], { corner: [5, 5] })
    tool.movePhoto(0, [12, 14])
    expect(tool.photo[0]).toEqual([12, 14])
    expect(tool.tracing[0].snap).toEqual({ corner: [5, 5] })
    tool.moveTracing(0, [6, 7])
    expect(tool.tracing[0]).toEqual({ uv: [6, 7] })
    tool.moveTracing(0, [5, 5], { corner: [5, 5] })
    expect(tool.pairs()[0]).toEqual({ photo: [12, 14], uv: [5, 5], snap: { corner: [5, 5] } })
    expect(() => tool.movePhoto(3, [0, 0])).not.toThrow()
  })

  it('keeps the tracing side of a swapped photo and asks only for the photo clicks', () => {
    const tool = LineupTool.swapped([{ uv: [0, 0] }, { uv: [40, 0], snap: { corner: [40, 0] } }, { uv: [40, 30] }])
    expect(tool.next()).toBe('photo')
    expect(tool.pairs()).toEqual([])
    expect(tool.clickTracing([1, 1])).toBe(false)
    tool.clickPhoto([10, 10])
    expect(tool.next()).toBe('photo')
    tool.clickPhoto([20, 10])
    tool.clickPhoto([20, 30])
    expect(tool.canDone()).toBe(true)
    expect(tool.pairs()[1]).toEqual({ photo: [20, 10], uv: [40, 0], snap: { corner: [40, 0] } })
    expect(tool.say()).toBe('Ready: Done lines the photo up')
    // Backspace takes only photo clicks off a swapped photo: the tracing side is what is kept.
    tool.undo()
    tool.undo()
    tool.undo()
    expect(tool.undo()).toBe(false)
    expect(tool.tracing).toHaveLength(3)
  })

  it('says what is wanted next', () => {
    const tool = new LineupTool()
    expect(tool.say()).toBe('Click point 1 on the photo')
    tool.clickPhoto([1, 2])
    expect(tool.say()).toBe('Click point 1 on the tracing')
  })
})

describe('what a click on the tracing snapped to', () => {
  const corner: PlaneSnap = { kind: 'corner', uv: [40, 30], part: 'block' }
  const centre: PlaneSnap = { kind: 'centre', uv: [20, 15], radius: 8, part: 'head', edge: 'E14' }
  const bare: PlaneSnap = { kind: 'centre', uv: [1, 1], radius: 2, part: 'head' }
  const vertex: PlaneSnap = { kind: 'vertex', uv: [0, 0], part: 'block', ref: 'block/V3' }
  const projected: PlaneSnap = { kind: 'vertex', uv: [0, 5], part: 'block', ref: 'block/V4', projected: true }

  it('is told to main as a corner by its place, a centre by its edge or its place, a vertex by its ref', () => {
    expect(lineupSnapOf(corner)).toEqual({ corner: [40, 30] })
    expect(lineupSnapOf(centre)).toEqual({ centre: 'E14' })
    expect(lineupSnapOf(bare)).toEqual({ centre: [1, 1] })
    expect(lineupSnapOf(vertex)).toEqual({ vertex: 'block/V3' })
  })

  it('does not offer a vertex that is not in the plane: a photo point cannot be lined up with where it only lands', () => {
    expect(lineupSnapOf(projected)).toBeNull()
    expect(offeredSnaps([corner, projected, vertex])).toEqual([corner, vertex])
  })
})

describe('the bar', () => {
  it('says the scale, the angle, the fit and how many points, as the line-up is told', () => {
    expect(barText({ transform: [1, 0, 0, 0, 1, 0, 0, 0, 1], scale: 4.73, angle: 2.1, fit: 0.4 }, 5)).toBe('scale 4.73 px/mm · angle 2.1° · fit 0.4 mm (5 points)')
  })

  it('says there is no spare point when there is no fit, and counts one point in the singular', () => {
    expect(barText({ transform: [1, 0, 0, 0, 1, 0, 0, 0, 1], scale: 4.7312, angle: -0.5 }, 2)).toBe('scale 4.731 px/mm · angle -0.5° · no spare point to check it (2 points)')
  })
})
