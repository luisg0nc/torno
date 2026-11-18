import { describe, expect, it, vi } from 'vitest'
import type { PlaneSnap } from '../../../shared/tracings'
import { MeasureTool, endOf, onOutline, spanReadout, spanWords } from './measureTool'

const CORNER: PlaneSnap = { kind: 'corner', uv: [0, 0], part: 'block' }
const CORNER_B: PlaneSnap = { kind: 'corner', uv: [30, 40], part: 'block' }

describe('the outline a free click may be on', () => {
  const cut = { parts: [{ loops: [{ points: [[0, 0], [40, 0], [40, 40], [0, 40]] as Array<[number, number]>, closed: true }] }] }
  it('is within the reach of a side of a loop, the closing side too, and not inside it', () => {
    expect(onOutline(cut, [20, 0.3], 0.5)).toBe(true)
    expect(onOutline(cut, [0.2, 20], 0.5)).toBe(true)
    expect(onOutline(cut, [20, 20], 0.5)).toBe(false)
    expect(onOutline(cut, [60, 20], 0.5)).toBe(false)
  })
})

describe('the Measure tool', () => {
  it('makes a span from two clicks, the second making it, and starts again', () => {
    const finish = vi.fn()
    const tool = new MeasureTool(finish)
    tool.click({ uv: [1, 2] })
    expect(tool.active).toBe(true)
    expect(finish).not.toHaveBeenCalled()
    tool.click({ uv: [4, 6] })
    expect(finish).toHaveBeenCalledWith({ uv: [1, 2], on: 'tracing' }, { uv: [4, 6], on: 'tracing' })
    expect(tool.active).toBe(false)
  })

  it('takes a snapped end as the kernel\'s point, in full, with its snap, and a free click to a ten thousandth', () => {
    expect(endOf({ uv: [0.0123456, 0.00001], snap: CORNER })).toEqual({ uv: [0, 0], on: 'tracing', snap: CORNER })
    expect(endOf({ uv: [1.234567, 2.000049] })).toEqual({ uv: [1.2346, 2], on: 'tracing' })
  })

  it('says an end is on the photo only for a free click there', () => {
    expect(endOf({ uv: [5, 5], photo: true })).toEqual({ uv: [5, 5], on: 'photo' })
    expect(endOf({ uv: [0, 0], snap: CORNER, photo: true }).on).toBe('tracing')
  })

  it('reads the number with ≈ unless both ends are snapped', () => {
    const a = endOf({ uv: [0, 0], snap: CORNER })
    expect(spanReadout(a, endOf({ uv: [30, 40], snap: CORNER_B }))).toBe('50 mm')
    expect(spanReadout(a, endOf({ uv: [30, 40] }))).toBe('≈ 50 mm')
    expect(spanReadout(endOf({ uv: [0, 0] }), endOf({ uv: [3, 4], snap: CORNER_B }))).toBe('≈ 50 mm')
    const tool = new MeasureTool(() => {})
    expect(tool.readout({ uv: [3, 4] })).toBe('')
    tool.click({ uv: [0, 0], snap: CORNER })
    expect(tool.readout({ uv: [30, 40], snap: CORNER_B })).toBe('50 mm')
    expect(tool.readout({ uv: [30, 40] })).toBe('≈ 50 mm')
  })

  it('splits the reading for its tag into the number, large, and whether it is only approximate', () => {
    const a = endOf({ uv: [0, 0], snap: CORNER })
    expect(spanWords(a, endOf({ uv: [30, 40], snap: CORNER_B }))).toEqual({ approx: false, value: '50' })
    expect(spanWords(a, endOf({ uv: [30, 40] }))).toEqual({ approx: true, value: '50' })
    const tool = new MeasureTool(() => {})
    expect(tool.reading({ uv: [3, 4] })).toBeNull()
    tool.click({ uv: [0, 0], snap: CORNER })
    expect(tool.reading({ uv: [30, 40], snap: CORNER_B })).toEqual({ approx: false, value: '50' })
  })

  it('makes nothing of a second click on the first point, and gives up the first end on Esc', () => {
    const finish = vi.fn()
    const changed = vi.fn()
    const tool = new MeasureTool(finish, changed)
    tool.click({ uv: [1, 2] })
    tool.click({ uv: [1, 2] })
    expect(finish).not.toHaveBeenCalled()
    expect(tool.cancel()).toBe(true)
    expect(tool.cancel()).toBe(false)
    expect(tool.active).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('ignores a click that is not a point', () => {
    const tool = new MeasureTool(() => {})
    tool.click({ uv: [Number.NaN, 1] })
    expect(tool.active).toBe(false)
  })

  it('draws the first end and the line to the pointer, y flipped when the plane\'s v runs down', () => {
    const tool = new MeasureTool(() => {})
    expect(tool.elements([5, 5], true, 10)).toBe('')
    tool.click({ uv: [1, 2] })
    expect(tool.elements(null, true, 10)).toContain('cx="1" cy="2"')
    expect(tool.elements([4, 6], false, 10)).toContain('x1="1" y1="-2" x2="4" y2="-6"')
  })
})
