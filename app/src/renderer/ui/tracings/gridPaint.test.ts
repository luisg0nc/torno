import { describe, expect, it } from 'vitest'
import { gridSteps, paintGrid } from './gridPaint'
import { PX_PER_MM } from './Sheet'

describe('the steps of the grid at a zoom', () => {
  it('is every mm and every 10 mm once a millimetre is three pixels', () => {
    expect(gridSteps(3)).toEqual({ fine: 1, coarse: 10 })
    expect(gridSteps(PX_PER_MM)).toEqual({ fine: 1, coarse: 10 })
    expect(gridSteps(2.9)).toEqual({ fine: null, coarse: 10 })
  })

  it('is every 100 mm once ten are fewer than six pixels, so that the lines do not blur into a tone', () => {
    expect(gridSteps(0.6)).toEqual({ fine: null, coarse: 10 })
    expect(gridSteps(0.59)).toEqual({ fine: null, coarse: 100 })
  })
})

/** The attributes written on a few elements, by their `data-grid` name. */
function fakeGrid() {
  const els: Record<string, { attrs: Record<string, string>; setAttribute(k: string, v: string): void }> = {}
  for (const name of ['fine', 'coarse', 'fine-path', 'coarse-path', 'axis-v', 'axis-u', 'fine-rect']) {
    const attrs: Record<string, string> = {}
    els[name] = { attrs, setAttribute: (k, v) => void (attrs[k] = v) }
  }
  const svg = { querySelector: (sel: string) => els[/data-grid="([^"]+)"/.exec(sel)?.[1] ?? ''] ?? null } as unknown as SVGSVGElement
  return { svg, els }
}

describe('the grid painted over the whole screen', () => {
  it('puts a line of the grid on every cell of the screen from the plane’s origin, however far it is panned', () => {
    const { svg, els } = fakeGrid()
    paintGrid(svg, { x: 1234.5, y: -80, k: 10 })
    expect(els.coarse.attrs).toMatchObject({ x: '1234', y: '-80.5', width: '100', height: '100' })
    expect(els.fine.attrs).toMatchObject({ x: '1234', y: '-80.5', width: '10', height: '10' })
    expect(els['coarse-path'].attrs.d).toBe('M0.5 0 V100 M0 0.5 H100')
    expect(els['fine-path'].attrs.d).toBe('M0.5 0 V10 M0 0.5 H10')
  })

  it('puts the lines of u = 0 and v = 0 where the origin is', () => {
    const { svg, els } = fakeGrid()
    paintGrid(svg, { x: 300, y: 200, k: 5 })
    expect(els['axis-v'].attrs).toMatchObject({ x1: '300', x2: '300' })
    expect(els['axis-u'].attrs).toMatchObject({ y1: '200', y2: '200' })
  })

  it('goes to a grid of 100 mm when far out, and turns the fine one off', () => {
    const { svg, els } = fakeGrid()
    paintGrid(svg, { x: 0, y: 0, k: 0.3 })
    expect(els.coarse.attrs.width).toBe('30')
    expect(els['fine-rect'].attrs.display).toBe('none')
    paintGrid(svg, { x: 0, y: 0, k: 4 })
    expect(els['fine-rect'].attrs.display).toBe('inline')
  })
})
