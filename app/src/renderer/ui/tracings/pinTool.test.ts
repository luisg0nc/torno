import { describe, expect, it, vi } from 'vitest'
import { MAX_NOTE } from '../../../shared/marks'
import type { Camera } from '../../../shared/view'
import { PinTool, pinMark } from './pinTool'

const setup = () => {
  const made: Array<{ uv: [number, number]; snapped: boolean; note: string }> = []
  const changed = vi.fn()
  const tool = new PinTool((uv, snapped, note) => made.push({ uv, snapped, note }), changed)
  return { tool, made, changed }
}
const free = (uv: [number, number]) => ({ uv, snapped: false })

describe('the Pin tool', () => {
  it('waits for the note at the point clicked, and makes the pin when it is typed', () => {
    const { tool, made } = setup()
    tool.click(free([12.5, 3]))
    expect(tool.active).toBe(true)
    expect(tool.draft).toEqual([12.5, 3])
    expect(made).toEqual([])
    expect(tool.text('  too thin here  ')).toBe(true)
    expect(made).toEqual([{ uv: [12.5, 3], snapped: false, note: 'too thin here' }])
    expect(tool.active).toBe(false)
  })

  it('takes a free click to a ten thousandth of a millimetre, and a snapped point in full', () => {
    const { tool, made } = setup()
    tool.click(free([1.234567891, 2]))
    tool.text('a')
    tool.click({ uv: [10.000000123456, 20.5], snapped: true })
    tool.text('b')
    expect(made).toEqual([
      { uv: [1.2346, 2], snapped: false, note: 'a' },
      { uv: [10.000000123456, 20.5], snapped: true, note: 'b' }
    ])
  })

  it('moves the waiting point with another click, and keeps one note', () => {
    const { tool, made } = setup()
    tool.click(free([1, 1]))
    tool.click(free([2, 2]))
    tool.text('there')
    expect(made).toEqual([{ uv: [2, 2], snapped: false, note: 'there' }])
  })

  it('makes no pin of a note that is empty, and lets the point go', () => {
    const { tool, made } = setup()
    tool.click(free([1, 1]))
    expect(tool.text('   ')).toBe(false)
    expect(made).toEqual([])
    expect(tool.active).toBe(false)
    expect(tool.text('nothing waits')).toBe(false)
  })

  it('keeps a note on one line, within what a mark holds', () => {
    const { tool, made } = setup()
    tool.click(free([0, 0]))
    tool.text(`a\nb ${'x'.repeat(MAX_NOTE + 10)}`)
    expect(made[0].note.startsWith('a b x')).toBe(true)
    expect(made[0].note).toHaveLength(MAX_NOTE)
  })

  it('gives up with Esc, saying whether there was anything to give up', () => {
    const { tool, made, changed } = setup()
    expect(tool.cancel()).toBe(false)
    tool.click(free([1, 1]))
    expect(tool.cancel()).toBe(true)
    expect(tool.active).toBe(false)
    expect(made).toEqual([])
    expect(changed).toHaveBeenCalled()
  })

  it('refuses a point that is not finite', () => {
    const { tool } = setup()
    tool.click(free([Number.NaN, 1]))
    expect(tool.active).toBe(false)
  })

  it('draws the point that waits as a ring, in the sheet\'s millimetres, whichever way v runs', () => {
    const { tool } = setup()
    tool.click(free([4, 6]))
    expect(tool.elements(true, 10)).toContain('cx="4" cy="6"')
    expect(tool.elements(false, 10)).toContain('cx="4" cy="-6"')
    tool.cancel()
    expect(tool.elements(true, 10)).toBe('')
  })
})

describe('the pin as a mark', () => {
  const placed = { objectId: 'bracket', layout: 'assembly', revision: 4, camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as Camera }
  const tracing = { id: 'T1', layout: 'assembly', plane: { origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0] } } as never

  it('is a pin of the person\'s on the tracing, at the point of the plane, in the object frame, with the build and view it was made on', () => {
    expect(pinMark(tracing, [3, 4], 'here', placed)).toEqual({ kind: 'pin', author: 'user', note: 'here', layout: 'assembly', revision: 4, camera: placed.camera, anchor: { point: [3, 4, 10] }, tracing: 'T1' })
  })
})
