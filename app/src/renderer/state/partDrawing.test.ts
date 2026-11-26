import { describe, expect, it } from 'vitest'
import type { Param } from '../../shared/scene'
import type { Outline, ShelfPart } from '../../shared/shelf'
import { DRAWING_SIZE, layoutPart, MAX_SCALE, SLAB, type Dim, type Placed } from './partDrawing'

const size = (name: string, doc: string | null, value: number): Param => ({ name, type: 'float', default: value, literal: true, doc })
const box = (x0: number, z0: number, x1: number, z1: number): Outline => ({ points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] })
const circle = (r: number, n = 24): Outline => ({ points: Array.from({ length: n }, (_, i): [number, number] => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]) })

// The fixture's EC11: a shaft 15 mm above the panel and a case 12 wide, 6.5 below it; a hole of 7.2; the room kept behind it.
function ec11(over: Partial<ShelfPart> = {}): ShelfPart {
  return {
    id: 'ec11',
    file: 'common/parts/ec11/part.py',
    name: 'EC11 rotary encoder',
    what: '',
    params: [
      size('shaft_d', 'datasheet EC11: the shaft', 6),
      size('shaft_h', 'datasheet EC11: the shaft above the panel', 15),
      size('body_w', 'measured: the body', 12),
      size('body_h', 'assumed: the body below the panel', 6.5),
      size('hole_d', 'derived: the bush and play', 7.2),
      size('behind', 'assumed: room behind', 10)
    ],
    checked: {},
    files: [],
    body: {
      bbox: { min: [-6, -6, -6.5], max: [6, 6, 15] },
      side: [{ points: [[-6, -6.5], [6, -6.5], [6, 0], [3, 0], [3, 15], [-3, 15], [-3, 0], [-6, 0]] }]
    },
    cutout: { side: [box(-3.6, -3, 3.6, 1)], plan: [circle(3.6)], size: { d: 7.2 } },
    keepout: { bbox: { min: [-8, -8, -10], max: [8, 8, 0] }, side: [box(-8, -10, 8, 0)], plan: [box(-8, -8, 8, 8)] },
    ...over
  }
}

const dim = (dims: Dim[], kind: Dim['kind']): Dim => dims.find((d) => d.kind === kind)!
const inside = (p: Placed, w: number, h: number): void => {
  const xs = [p.line.x1, p.line.x2, p.text.x, ...p.ext.flatMap((e) => [e.x1, e.x2])]
  const ys = [p.line.y1, p.line.y2, p.text.y, ...p.ext.flatMap((e) => [e.y1, e.y2])]
  for (const x of xs) expect(x).toBeGreaterThan(0), expect(x).toBeLessThan(w)
  for (const y of ys) expect(y).toBeGreaterThan(0), expect(y).toBeLessThan(h)
}

describe('layoutPart', () => {
  const layout = layoutPart(ec11())!

  it('is null for a part with no body (it did not build)', () => {
    expect(layoutPart(ec11({ body: undefined }))).toBeNull()
    expect(layoutPart(ec11({ body: { bbox: { min: [0, 0, 0], max: [1, 1, 1] }, side: [] } }))).toBeNull()
  })

  it('gives the dimensions of the kernel\'s numbers: the cutout, the height above the panel, the depth below it, the body\'s width', () => {
    expect(layout.dims.map((d) => d.kind)).toEqual(['cutout', 'above', 'below', 'width'])
    expect(layout.dims.map((d) => d.text)).toEqual(['Ø 7.2', '15', '6.5', '12'])
    expect(layout.dims.map((d) => d.value)).toEqual([7.2, 15, 6.5, 12])
  })

  it('takes each one\'s line style from the one size of equal value: derived dotted, datasheet solid, assumed dashed, measured ringed', () => {
    expect(layout.dims.map((d) => d.param)).toEqual(['hole_d', 'shaft_h', 'body_h', 'body_w'])
    expect(layout.dims.map((d) => d.style)).toEqual(['mo', 'so', 'as', 'ck'])
    expect(layout.dims.map((d) => d.side?.mark !== undefined)).toEqual([false, false, false, true])
  })

  it('a size the person checked is drawn as checked', () => {
    const l = layoutPart(ec11({ checked: { body_h: { value: 6.6, date: '2026-11-26' } } }))!
    expect(dim(l.dims, 'below')).toMatchObject({ style: 'ck', param: 'body_h' })
    expect(dim(l.dims, 'below').side?.mark).toBeDefined()
  })

  it('draws a dimension plain when no size, or more than one, has its value', () => {
    const none = layoutPart(ec11({ params: [size('body_h', 'assumed: x', 6.4)] }))!
    expect(dim(none.dims, 'below')).toMatchObject({ style: 'plain', param: null })
    const two = layoutPart(ec11({ params: [size('a', 'assumed: x', 15), size('b', 'datasheet: y', 15)] }))!
    expect(dim(two.dims, 'above')).toMatchObject({ style: 'plain', param: null })
  })

  it('compares with a millionth of a mm, no more', () => {
    const near = layoutPart(ec11({ params: [size('shaft_h', 'datasheet: x', 15 + 5e-7)] }))!
    expect(dim(near.dims, 'above').param).toBe('shaft_h')
    const far = layoutPart(ec11({ params: [size('shaft_h', 'datasheet: x', 15 + 5e-6)] }))!
    expect(dim(far.dims, 'above').param).toBeNull()
  })

  it('draws the panel as a 2 mm slab with a gap where the cutout crosses it', () => {
    expect(SLAB).toBe(2)
    expect(layout.panels).toHaveLength(2)
    const [left, right] = layout.panels
    expect(left.h).toBeCloseTo(2 * layout.scale, 6)
    expect(right.y).toBeCloseTo(left.y, 6)
    // The gap is the cutout's width, 7.2 mm, centred on the part.
    expect(right.x - (left.x + left.w)).toBeCloseTo(7.2 * layout.scale, 6)
    expect(left.x + left.w + 3.6 * layout.scale).toBeCloseTo(layout.origin.x, 6)
  })

  it('keeps the panel whole when the part has no cutout, and has no plan', () => {
    const l = layoutPart(ec11({ cutout: undefined }))!
    expect(l.panels).toHaveLength(1)
    expect(l.plan).toBeNull()
    expect(l.dims.map((d) => d.kind)).toEqual(['above', 'below', 'width'])
  })

  it('has no dashed box without a keep-out, and no label for it', () => {
    const l = layoutPart(ec11({ keepout: undefined }))!
    expect(l.keep).toBeNull()
    expect(l.keepLabel).toBeNull()
    expect(layout.keep).toMatch(/^M/)
    expect(layout.keepLabel).not.toBeNull()
  })

  it('says a window as w × h, in the plan and on the side', () => {
    const l = layoutPart(ec11({ cutout: { side: [box(-16.7, -3, 16.7, 1)], plan: [box(-16.7, -9.2, 16.7, 9.2)], size: { w: 33.4, h: 18.4 } } }))!
    const cut = dim(l.dims, 'cutout')
    expect(cut.text).toBe('33.4 × 18.4')
    expect(cut.value).toBe(33.4)
    expect(cut.plan).not.toBeNull()
    // The two numbers have no size of the part to take a style from.
    expect(cut.style).toBe('plain')
  })

  it('takes the least sure style of the window\'s two sizes', () => {
    const params = [size('win_w', 'datasheet: x', 33.4), size('win_h', 'assumed: y', 18.4)]
    const l = layoutPart(ec11({ params, cutout: { side: [box(-16.7, -3, 16.7, 1)], plan: [box(-16.7, -9.2, 16.7, 9.2)], size: { w: 33.4, h: 18.4 } } }))!
    expect(dim(l.dims, 'cutout').style).toBe('as')
  })

  it('has no height above the panel for a part that stays below it, no depth for one that stays above', () => {
    const low = layoutPart(ec11({ body: { bbox: { min: [-6, -6, -6.5], max: [6, 6, 0] }, side: [box(-6, -6.5, 6, 0)] } }))!
    expect(low.dims.map((d) => d.kind)).not.toContain('above')
    const high = layoutPart(ec11({ body: { bbox: { min: [-6, -6, 0], max: [6, 6, 9] }, side: [box(-6, 0, 6, 9)] } }))!
    expect(high.dims.map((d) => d.kind)).not.toContain('below')
  })

  it('fits its box, every line and every word of it', () => {
    expect(layout.width).toBe(DRAWING_SIZE.width)
    for (const d of layout.dims) {
      if (d.side) inside(d.side, layout.width, layout.height)
      if (d.plan) inside(d.plan, layout.width, layout.height)
    }
    for (const p of layout.panels) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(layout.width)
    }
  })

  it('is scaled to fit, and a tiny insert is not drawn huge', () => {
    const insert = ec11({
      params: [],
      body: { bbox: { min: [-2.3, -2.3, -5.7], max: [2.3, 2.3, 0] }, side: [box(-2.3, -5.7, 2.3, 0)] },
      cutout: { side: [box(-2, -3, 2, 1)], plan: [circle(2)], size: { d: 4 } },
      keepout: undefined
    })
    expect(layoutPart(insert)!.scale).toBeCloseTo(MAX_SCALE, 6)
    const big = ec11({ body: { bbox: { min: [-60, -60, -80], max: [60, 60, 120] }, side: [box(-60, -80, 60, 120)] }, keepout: undefined })
    const l = layoutPart(big)!
    expect(l.scale).toBeLessThan(layout.scale)
    for (const d of l.dims) if (d.side) inside(d.side, l.width, l.height)
  })

  it('scales to the larger of the part and its keep-out', () => {
    const wide = layoutPart(ec11({ keepout: { bbox: { min: [-30, -30, -10], max: [30, 30, 0] }, side: [box(-30, -10, 30, 0)], plan: [box(-30, -30, 30, 30)] } }))!
    expect(wide.scale).toBeLessThan(layout.scale)
  })

  it('draws the plan: the sheet, the hole, its centre lines, and the dimension under it', () => {
    const plan = layout.plan!
    expect(plan.cutout).toMatch(/^M/)
    expect(plan.keep).toMatch(/^M/)
    expect(plan.lines).toHaveLength(2)
    expect(plan.sheet.w).toBeCloseTo(plan.sheet.h, 6)
    // The hole's diameter is 7.2 mm at the plan's own scale.
    const d = dim(layout.dims, 'cutout').plan!
    expect(d.line.x2 - d.line.x1).toBeCloseTo(7.2 * plan.scale, 6)
    expect(d.line.y1).toBeGreaterThan(plan.sheet.y + plan.sheet.h)
  })

  it('draws the body and the keep-out as one path each, in pixels, with +Z up', () => {
    const l = layout
    expect(l.body).toMatch(/^M[\d. -]+(L[\d. -]+)+Z/)
    // The shaft's top (z = 15) is above the panel's top (z = 0): a smaller y.
    const [top, panel] = [l.origin.y - 15 * l.scale, l.origin.y]
    expect(top).toBeLessThan(panel)
    expect(l.panels[0].y).toBeCloseTo(panel, 6)
  })
})
