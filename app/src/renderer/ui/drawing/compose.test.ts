import { describe, expect, it } from 'vitest'
import { LABEL_LINE, LABEL_PAD } from './labelbox'
import { paintLabels } from './compose'

// The picture of a note has its labels and arrows painted over the ink: a box with the text, and a line with a head.

type Call = [string, ...unknown[]]
function fake() {
  const calls: Call[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, name: string) => {
      if (name === 'measureText') return (text: string) => ({ width: text.length * 10 })
      if (name in target) return target[name]
      return (...args: unknown[]) => void calls.push([name, ...args])
    },
    set: (target, name: string, value) => {
      target[name] = value
      if (name === 'font') calls.push(['font', value])
      return true
    }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}
const look = { ink: '#B5127A', casing: '#FAF9F6' }
const names = (calls: Call[]): string[] => calls.map((c) => c[0])

describe('paintLabels', () => {
  it('paints the box of a label and its text, line by line', () => {
    const { ctx, calls } = fake()
    paintLabels(ctx, [{ x: 20, y: 30, text: 'one two' }], look, 'sans-serif')
    expect(calls.filter((c) => c[0] === 'fillRect')).toEqual([['fillRect', 20, 30, 70 + 2 * LABEL_PAD, LABEL_LINE + 2 * LABEL_PAD]])
    expect(calls.filter((c) => c[0] === 'fillText')).toEqual([['fillText', 'one two', 20 + LABEL_PAD, 30 + LABEL_PAD + LABEL_LINE / 2]])
  })
  it('paints no line for a label with no arrow', () => {
    const { ctx, calls } = fake()
    paintLabels(ctx, [{ x: 20, y: 30, text: 'a' }], look, 'sans-serif')
    expect(names(calls)).not.toContain('lineTo')
  })
  it('paints the arrow of a label first, so that the box is over its tail, with a head of two barbs', () => {
    const { ctx, calls } = fake()
    paintLabels(ctx, [{ x: 20, y: 30, text: 'a', to: { x: 300, y: 50 } }], look, 'sans-serif')
    expect(names(calls).indexOf('lineTo')).toBeLessThan(names(calls).indexOf('fillRect'))
    // The line, and the two barbs, each drawn over its casing.
    expect(calls.filter((c) => c[0] === 'stroke').length).toBeGreaterThanOrEqual(2)
    expect(calls.filter((c) => c[0] === 'lineTo').some((c) => c[1] === 300 && c[2] === 50)).toBe(true)
  })
})
