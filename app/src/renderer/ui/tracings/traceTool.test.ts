import { describe, expect, it, vi } from 'vitest'
import type { LayerShape } from '../../../shared/tracings'
import { TraceTool } from './traceTool'

/** Ten pixels to the millimetre: a click within a millimetre of the first point closes a line. */
const K = 10
const setup = () => {
  const sent: LayerShape[] = []
  const changed = vi.fn()
  const tool = new TraceTool((shape) => sent.push(shape), changed)
  return { tool, sent, changed }
}
const free = (uv: [number, number]) => ({ uv, snapped: false })
const exact = (uv: [number, number]) => ({ uv, snapped: true })

describe('a line', () => {
  it('takes its points one click at a time and ends with Enter as an open polyline', () => {
    const { tool, sent } = setup()
    tool.click(free([0, 0]), K)
    tool.click(free([10, 0]), K)
    tool.click(free([10, 5]), K)
    expect(sent).toEqual([])
    expect(tool.end()).toBe(true)
    expect(sent).toEqual([{ kind: 'polyline', points: [[0, 0], [10, 0], [10, 5]] }])
    expect(tool.active).toBe(false)
  })

  it('closes on its first point, and the first point is not given twice', () => {
    const { tool, sent } = setup()
    for (const p of [[0, 0], [10, 0], [10, 5]] as const) tool.click(free([...p]), K)
    tool.click(free([0.4, 0.3]), K)
    expect(sent).toEqual([{ kind: 'polyline', points: [[0, 0], [10, 0], [10, 5]], closed: true }])
  })

  it('does not close on the first point before it has three, and does not take a double click twice', () => {
    const { tool, sent } = setup()
    tool.click(free([0, 0]), K)
    tool.click(free([10, 0]), K)
    tool.click(free([10.02, 0.02]), K)
    expect(tool.draft.points).toEqual([[0, 0], [10, 0]])
    tool.click(free([0.1, 0.1]), K)
    expect(sent).toEqual([])
    expect(tool.draft.points).toHaveLength(2)
  })

  it('has nothing to end with one point, and says so', () => {
    const { tool, sent } = setup()
    tool.click(free([1, 1]), K)
    expect(tool.end()).toBe(false)
    expect(sent).toEqual([])
    expect(tool.active).toBe(true)
  })

  it('takes the last point away with Backspace, and the whole line when it was the first', () => {
    const { tool, changed } = setup()
    tool.click(free([0, 0]), K)
    tool.click(free([10, 0]), K)
    changed.mockClear()
    expect(tool.back()).toBe(true)
    expect(tool.draft.points).toEqual([[0, 0]])
    expect(changed).toHaveBeenCalledTimes(1)
    expect(tool.back()).toBe(true)
    expect(tool.active).toBe(false)
    expect(tool.back()).toBe(false)
  })

  it('gives a snapped point as the kernel has it and a free one to a ten thousandth of a millimetre', () => {
    const { tool, sent } = setup()
    tool.click(exact([12.123456789012, 3.000000000001]), K)
    tool.click(free([20.123456789, 7.98765432]), K)
    tool.end()
    expect(sent[0]).toEqual({ kind: 'polyline', points: [[12.123456789012, 3.000000000001], [20.1235, 7.9877]] })
  })

  it('gives up what is under way with Esc, and says whether there was any', () => {
    const { tool, sent } = setup()
    expect(tool.cancel()).toBe(false)
    tool.click(free([0, 0]), K)
    expect(tool.cancel()).toBe(true)
    expect(tool.active).toBe(false)
    expect(sent).toEqual([])
  })

  it('sends one shape for each finish, and starts again after it', () => {
    const { tool, sent } = setup()
    tool.click(free([0, 0]), K)
    tool.click(free([5, 0]), K)
    tool.end()
    tool.click(free([0, 5]), K)
    tool.click(free([5, 5]), K)
    tool.end()
    expect(sent).toHaveLength(2)
  })
})

describe('a circle', () => {
  it('is its centre and then a point on it, sent in mm with the radius between them', () => {
    const { tool, sent } = setup()
    tool.setMode('circle')
    tool.click(exact([20, 15]), K)
    expect(sent).toEqual([])
    tool.click(free([26, 23]), K)
    expect(sent).toEqual([{ kind: 'circle', centre: [20, 15], radius: 10 }])
    expect(tool.active).toBe(false)
  })

  it('is not made with no radius', () => {
    const { tool, sent } = setup()
    tool.setMode('circle')
    tool.click(free([5, 5]), K)
    tool.click(free([5.01, 5]), K)
    expect(sent).toEqual([])
    expect(tool.draft.points).toEqual([[5, 5]])
  })

  it('has Enter for nothing and Backspace takes the centre back', () => {
    const { tool } = setup()
    tool.setMode('circle')
    tool.click(free([5, 5]), K)
    expect(tool.end()).toBe(false)
    expect(tool.back()).toBe(true)
    expect(tool.active).toBe(false)
  })
})

describe('a label', () => {
  it('is a click and then its text', () => {
    const { tool, sent } = setup()
    tool.setMode('label')
    tool.click(free([3, 4]), K)
    expect(tool.draft.label).toEqual([3, 4])
    expect(sent).toEqual([])
    expect(tool.text('  head bolt  ')).toBe(true)
    expect(sent).toEqual([{ kind: 'label', at: [3, 4], text: 'head bolt' }])
    expect(tool.draft.label).toBeNull()
  })

  it('is let go with no text, and one line when the text has several', () => {
    const { tool, sent } = setup()
    tool.setMode('label')
    tool.click(free([3, 4]), K)
    expect(tool.text('   ')).toBe(false)
    expect(tool.active).toBe(false)
    tool.click(free([3, 4]), K)
    tool.text('two\nlines')
    expect(sent).toEqual([{ kind: 'label', at: [3, 4], text: 'two lines' }])
  })

  it('is taken back by Backspace and Esc before it has text', () => {
    const { tool } = setup()
    tool.setMode('label')
    tool.click(free([3, 4]), K)
    expect(tool.cancel()).toBe(true)
    tool.click(free([3, 4]), K)
    expect(tool.back()).toBe(true)
    expect(tool.active).toBe(false)
  })
})

it('drops what is under way when the way of tracing changes, and says what changed', () => {
  const { tool, changed } = setup()
  tool.click(free([0, 0]), K)
  changed.mockClear()
  tool.setMode('circle')
  expect(tool.active).toBe(false)
  expect(tool.mode).toBe('circle')
  expect(changed).toHaveBeenCalledTimes(1)
  tool.setMode('circle')
  expect(changed).toHaveBeenCalledTimes(1)
})

describe('what is drawn while it is under way', () => {
  it('is nothing with nothing under way', () => {
    const { tool } = setup()
    expect(tool.elements(null, false, K)).toBe('')
  })

  it('is the line so far to the pointer, and a ring on the first point where a click would close it', () => {
    const { tool } = setup()
    for (const p of [[0, 0], [10, 0], [10, 5]] as const) tool.click(free([...p]), K)
    const away = tool.elements([20, 20], false, K)
    expect(away).toContain('class="tr-draft-line"')
    expect(away).toContain('M0 0 L10 0 L10 -5 L20 -20')
    expect(away).not.toContain('tr-draft-close')
    expect(tool.elements([0.2, 0.1], false, K)).toContain('tr-draft-close')
  })

  it('runs v down the screen when the plane does', () => {
    const { tool } = setup()
    tool.click(free([0, 0]), K)
    tool.click(free([10, 5]), K)
    expect(tool.elements(null, true, K)).toContain('M0 0 L10 5')
  })

  it('is the circle the pointer would make, and the label’s place', () => {
    const { tool } = setup()
    tool.setMode('circle')
    tool.click(free([2, 2]), K)
    expect(tool.elements([5, 6], false, K)).toContain('r="5"')
    tool.setMode('label')
    tool.click(free([3, 4]), K)
    expect(tool.elements(null, false, K)).toContain('tr-draft-at')
  })
})
