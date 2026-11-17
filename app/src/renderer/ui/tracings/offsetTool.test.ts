import { describe, expect, it, vi } from 'vitest'
import { offsetWords } from '../../../shared/tracings'
import { type Grabbed, OffsetTool, shapeLabel } from './offsetTool'

const BOLT: Grabbed = { layer: 2, layerName: 'head bolts', index: 3, shape: { name: 'head bolt 4', kind: 'circle', centre: [10, 5], radius: 3 } }
const PLATE: Grabbed = { layer: 2, layerName: 'head bolts', index: 0, shape: { kind: 'polyline', points: [[0, 0], [4, 0], [4, 2], [0, 2]], closed: true } }

describe('the Should be here tool', () => {
  it('drags a shape and makes one mark when it is let go, of the layer, the shape and how far', () => {
    const finish = vi.fn()
    const tool = new OffsetTool(finish)
    tool.press(BOLT, [10, 5])
    expect(tool.dragging).toBe(true)
    tool.move([9, 5.4])
    expect(finish).not.toHaveBeenCalled()
    tool.release([8.2, 5.6])
    expect(finish).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledWith(2, 3, [-1.8, 0.6])
    expect(tool.dragging).toBe(false)
  })

  it('keeps a drag with Shift to the axis it has gone further along: by[1] is 0 for a mostly horizontal one', () => {
    const finish = vi.fn()
    const tool = new OffsetTool(finish)
    tool.press(BOLT, [0, 0])
    tool.move([5, 1.2], true)
    expect(tool.readout()).toContain('5 mm right')
    expect(tool.readout()).not.toContain('up')
    tool.release([5, 1.2], true)
    expect(finish).toHaveBeenCalledWith(2, 3, [5, 0])
    const vertical = new OffsetTool(finish)
    vertical.press(BOLT, [0, 0])
    vertical.release([0.4, -6], true)
    expect(finish).toHaveBeenLastCalledWith(2, 3, [0, -6])
  })

  it('adds a tenth of a millimetre for an arrow key: while dragging, and to the shape just placed', () => {
    const finish = vi.fn()
    const tool = new OffsetTool(finish)
    expect(tool.nudge(0)).toBe(false)
    tool.press(BOLT, [0, 0])
    tool.move([1, 1])
    expect(tool.nudge(0)).toBe(true)
    expect(finish).not.toHaveBeenCalled()
    tool.release([1, 1])
    expect(finish).toHaveBeenLastCalledWith(2, 3, [0.9, 1])
    // Right, up and down, each by 0.1: no float dust in what is sent.
    tool.nudge(1)
    expect(finish).toHaveBeenLastCalledWith(2, 3, [1, 1])
    tool.nudge(2)
    expect(finish).toHaveBeenLastCalledWith(2, 3, [1, 1.1])
    tool.nudge(3)
    tool.nudge(3)
    expect(finish).toHaveBeenLastCalledWith(2, 3, [1, 0.9])
  })

  it('keeps a nudge made while dragging when the pointer moves on', () => {
    const tool = new OffsetTool(vi.fn())
    tool.press(BOLT, [0, 0])
    tool.nudge(0)
    tool.move([2, 0])
    expect(tool.readout()).toContain('1.9 mm right')
  })

  it('makes no mark for a drag that went nowhere, and none once cancelled', () => {
    const finish = vi.fn()
    const tool = new OffsetTool(finish)
    tool.press(BOLT, [3, 3])
    tool.release([3, 3])
    expect(finish).not.toHaveBeenCalled()
    expect(tool.active).toBe(false)
    tool.press(BOLT, [3, 3])
    tool.move([5, 5])
    expect(tool.cancel()).toBe(true)
    tool.release([5, 5])
    expect(finish).not.toHaveBeenCalled()
    expect(tool.cancel()).toBe(false)
  })

  it('reads the move as the mark will tell it: left, right, up and down alike', () => {
    for (const by of [[-1.8, 0.6], [1.8, -0.6], [-1.8, -0.6], [1.8, 0.6], [0, 2], [3, 0]] as Array<[number, number]>) {
      const tool = new OffsetTool(vi.fn(), () => {}, (layer, index) => (layer === 2 && index === 3 ? 'M15' : undefined))
      tool.press(BOLT, [0, 0])
      tool.move(by)
      expect(tool.readout()).toBe(`M15 head bolt 4 should be here · ${offsetWords(by)}`)
    }
    const tool = new OffsetTool(vi.fn())
    tool.press(BOLT, [0, 0])
    tool.move([-1.8, 0.6])
    expect(tool.readout()).toBe('head bolt 4 should be here · 1.8 mm left, 0.6 mm up')
  })

  it('names a shape with no name by its place in its layer', () => {
    expect(shapeLabel(PLATE)).toBe('shape 1 of head bolts')
    expect(shapeLabel(BOLT)).toBe('head bolt 4')
  })

  it('draws the shape where it was ghosted, the moved copy and the arrow, v flipped for a plane whose v runs down', () => {
    const tool = new OffsetTool(vi.fn())
    expect(tool.elements(true, 10)).toBe('')
    tool.press(BOLT, [0, 0])
    tool.move([-1.8, 0.6])
    const out = tool.elements(false, 10)
    expect(out).toContain('class="tr-offset-ghost" cx="10" cy="-5" r="3"')
    expect(out).toContain('class="tr-offset-moved" cx="8.2" cy="-5.6" r="3"')
    expect(out).toContain('class="tr-offset-arrow" x1="10" y1="-5" x2="8.2" y2="-5.6"')
    tool.cancel()
    tool.press(PLATE, [0, 0])
    tool.move([1, 0])
    expect(tool.elements(true, 10)).toContain('d="M1 0 L5 0 L5 2 L1 2 Z"')
  })
})
