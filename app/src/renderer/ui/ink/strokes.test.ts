import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Stroke } from '../../state/onboard'
import { BOARD, CASING_PX, PNG_GRID, PNG_GROUND, PNG_INK, OVER_PICTURE, doodlePng, fitBackground, paintStroke, paintStrokes, straighten } from './strokes'

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

describe('OVER_PICTURE', () => {
  it('is dark ink in a light halo, so a stroke shows over a white and over a dark picture', () => {
    const { ctx, ops } = recorder()
    paintStroke(ctx, pen([[0, 0], [10, 0]]), OVER_PICTURE)
    expect(ops.filter((o) => o.startsWith('stroke'))).toEqual([`stroke ${PNG_GROUND} ${3 + 2 * CASING_PX} source-over`, `stroke ${PNG_INK} 3 source-over`])
  })
})

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

/** A canvas of coloured pixels, enough of OffscreenCanvas for `doodlePng`: fills, a stroke's points, and one canvas or picture drawn on another. */
class PixelCanvas {
  pixels: Array<string | null>
  constructor(public width: number, public height: number) {
    this.pixels = new Array(width * height).fill(null)
  }
  getContext() {
    const self = this
    let path: Array<Array<[number, number]>> = []
    const put = (x: number, y: number, colour: string | null): void => {
      const [px, py] = [Math.round(x), Math.round(y)]
      if (px >= 0 && py >= 0 && px < self.width && py < self.height) self.pixels[py * self.width + px] = colour
    }
    const ctx = {
      canvas: self, lineWidth: 1, strokeStyle: '', fillStyle: '', globalCompositeOperation: 'source-over', lineCap: '', lineJoin: '',
      save() {}, restore() {}, beginPath: () => void (path = []),
      moveTo: (x: number, y: number) => void path.push([[x, y]]), lineTo: (x: number, y: number) => void path.at(-1)!.push([x, y]),
      arc: (x: number, y: number) => void path.push([[x, y]]),
      fill: () => path.flat().forEach(([x, y]) => put(x, y, ctx.fillStyle)),
      stroke() {
        // Every pixel along the segments: thin, but enough to see where ink is.
        for (const line of path) {
          for (let i = 0; i < line.length; i += 1) {
            const [a, b] = [line[i], line[i + 1] ?? line[i]]
            const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
            for (let s = 0; s <= steps; s += 1) put(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps, ctx.globalCompositeOperation === 'destination-out' ? null : ctx.strokeStyle)
          }
        }
      },
      clearRect: () => self.pixels.fill(null),
      fillRect: (x: number, y: number, w: number, h: number) => {
        for (let j = y; j < y + h; j += 1) for (let i = x; i < x + w; i += 1) put(i, j, ctx.fillStyle)
      },
      drawImage(src: PixelCanvas | { colour: string }, x = 0, y = 0, w?: number, h?: number) {
        if (src instanceof PixelCanvas) src.pixels.forEach((c, k) => c !== null && put(k % src.width, Math.floor(k / src.width), c))
        else for (let j = y; j < y + h!; j += 1) for (let i = x; i < x + w!; i += 1) put(i, j, src.colour)
      }
    }
    return ctx
  }
  async convertToBlob() {
    return new Blob([JSON.stringify(this.pixels)])
  }
}
const pixelsOf = async (png: Uint8Array): Promise<Array<string | null>> => JSON.parse(new TextDecoder().decode(png))
const at = (px: Array<string | null>, x: number, y: number): string | null => px[y * BOARD.width + x]

describe('the PNG of a doodle', () => {
  beforeEach(() => void vi.stubGlobal('OffscreenCanvas', PixelCanvas))
  afterEach(() => void vi.unstubAllGlobals())
  const photo = (width: number, height: number) => ({ width, height, colour: '#c0392b' }) as unknown as ImageBitmap

  it('has the photo under the ink when it is drawn over one: the photo where there is no ink, the ink over it, and no grid', async () => {
    const stroke: Stroke = { tool: 'pen', width: 3, points: [[100, 400], [300, 400]] }
    const px = await pixelsOf(await doodlePng([stroke], true, photo(600, 400)))
    expect(at(px, 600, 100)).toBe('#c0392b')
    expect(at(px, 200, 400)).toBe(PNG_INK)
    // Where a grid line would be, on the photo, it is the photo.
    expect(at(px, 41, 100)).toBe('#c0392b')
  })

  it('fits the photo to the board and leaves the white ground at the sides of a photo of another shape', async () => {
    const px = await pixelsOf(await doodlePng([], true, photo(400, 400)))
    expect(fitBackground(400, 400)).toEqual({ x: 200, y: 0, width: 800, height: 800 })
    expect(at(px, 10, 10)).toBe(PNG_GROUND)
    expect(at(px, 41, 100)).toBe(PNG_GROUND)
    expect(at(px, 600, 400)).toBe('#c0392b')
  })

  it('has the grid on the white ground when there is no photo', async () => {
    const px = await pixelsOf(await doodlePng([], true))
    expect(at(px, 10, 10)).toBe(PNG_GROUND)
    expect(at(px, 41, 100)).toBe(PNG_GRID)
  })
})
