import { describe, expect, it } from 'vitest'
import type { Stroke } from '../../state/onboard'
import { CASING_PX, paintStroke, paintStrokes, straighten } from './strokes'

/** A 2D context that writes down what is drawn with it. */
function recorder(width = 120, height = 80) {
  const ops: string[] = []
  const ctx = {
    canvas: { width, height }, lineWidth: 1, strokeStyle: '', fillStyle: '', globalCompositeOperation: 'source-over', lineCap: '', lineJoin: '',
    save: () => void ops.push('save'), restore: () => void ops.push('restore'), beginPath: () => {},
    moveTo: (x: number, y: number) => void ops.push(`move ${x},${y}`), lineTo: (x: number, y: number) => void ops.push(`line ${x},${y}`),
    arc: () => void ops.push('arc'),
    fill(this: { fillStyle: string; lineWidth: number }) { ops.push(`fill ${this.fillStyle}`) },
    stroke(this: { strokeStyle: string; lineWidth: number; globalCompositeOperation: string }) { ops.push(`stroke ${this.strokeStyle} ${this.lineWidth} ${this.globalCompositeOperation}`) },
    clearRect: (x: number, y: number, w: number, h: number) => void ops.push(`clear ${x},${y},${w},${h}`)
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}
const pen = (points: Array<[number, number]>, width = 3): Stroke => ({ tool: 'pen', width, points })

describe('paintStroke', () => {
  it('draws a pen in its ink alone when there is no casing', () => {
    const { ctx, ops } = recorder()
    paintStroke(ctx, pen([[0, 0], [10, 0]]), { ink: '#111111' })
    expect(ops.filter((o) => o.startsWith('stroke'))).toEqual(['stroke #111111 3 source-over'])
  })
  it('draws the casing under the ink, wider on each side', () => {
    const { ctx, ops } = recorder()
    paintStroke(ctx, pen([[0, 0], [10, 0]]), { ink: '#b5127a', casing: '#fafaf6' })
    expect(ops.filter((o) => o.startsWith('stroke'))).toEqual([`stroke #fafaf6 ${3 + 2 * CASING_PX} source-over`, 'stroke #b5127a 3 source-over'])
  })
  it('draws what was added from a point back, the ink from one further back, so that the casing covers no ink drawn before', () => {
    const { ctx, ops } = recorder()
    paintStroke(ctx, pen([[0, 0], [10, 0], [20, 0], [30, 0]]), { ink: '#b5127a', casing: '#fafaf6' }, 3)
    const moves = ops.filter((o) => o.startsWith('move'))
    expect(moves).toEqual(['move 20,0', 'move 10,0'])
  })
  it('rubs out with the eraser, and never cases it', () => {
    const { ctx, ops } = recorder()
    paintStroke(ctx, { tool: 'eraser', width: 28, points: [[0, 0], [10, 0]] }, { ink: '#b5127a', casing: '#fafaf6' })
    expect(ops.filter((o) => o.startsWith('stroke'))).toEqual(['stroke #b5127a 28 destination-out'])
  })
  it('draws a stroke of one point as a dot, cased', () => {
    const { ctx, ops } = recorder()
    paintStroke(ctx, pen([[5, 5]]), { ink: '#b5127a', casing: '#fafaf6' })
    expect(ops.filter((o) => o.startsWith('fill'))).toEqual(['fill #fafaf6', 'fill #b5127a'])
  })
})

it('paints every stroke on a canvas cleared to its own size', () => {
  const { ctx, ops } = recorder(1280, 853)
  paintStrokes(ctx, [pen([[0, 0], [1, 1]]), pen([[2, 2], [3, 3]])], { ink: '#111111' })
  expect(ops[0]).toBe('clear 0,0,1280,853')
  expect(ops.filter((o) => o.startsWith('stroke'))).toHaveLength(2)
})

describe('straighten', () => {
  it('keeps the first point and the pointer, and nothing between', () => {
    const s: Stroke = { tool: 'pen', width: 3, points: [[10, 10], [20, 40], [35, 12]] }
    straighten(s, 100.04, 50)
    expect(s.points).toEqual([[10, 10], [100, 50]])
    straighten(s, 200, 10)
    expect(s.points).toEqual([[10, 10], [200, 10]])
  })

  it('is a dot while the pointer has not left the first point', () => {
    const s: Stroke = { tool: 'pen', width: 3, points: [[10, 10], [30, 30]] }
    straighten(s, 10.5, 10)
    expect(s.points).toEqual([[10, 10]])
  })
})
