import type { View } from './Sheet'

// The millimetre grid of a tracing's sheet: two tilings of the screen (every mm, every 10 mm) and the lines of u = 0 and v = 0,
// painted from where the sheet stands, so that it covers the whole of what is seen however far the sheet is panned or zoomed out,
// not only the outline's box. It is attributes written on elements the page holds, never state: panning writes a few of them.

/** How many pixels a millimetre has to be for the 1 mm lines to be told apart (three), and a 10 mm cell for its lines to be (six). */
const FINE_FROM = 3
const COARSE_FROM = 6

/** The grid's steps in mm at `k` pixels for a millimetre: 1 mm when it can be told, and 10 mm, or 100 mm when far out. */
export function gridSteps(k: number): { fine: number | null; coarse: number } {
  return { fine: k >= FINE_FROM ? 1 : null, coarse: 10 * k >= COARSE_FROM ? 10 : 100 }
}

const text = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)

/**
 * Sets the grid `svg` (made by `TracingView`: patterns `[data-grid=fine]` and `[data-grid=coarse]` with their paths, a rect
 * `fine-rect`, and the lines `axis-v` and `axis-u`) to where the sheet `view` stands. A line is drawn half a pixel in from the
 * tile's edge so that the tile does not cut it.
 */
export function paintGrid(svg: SVGSVGElement, view: View): void {
  const set = (name: string, attrs: Record<string, string>): void => {
    const el = svg.querySelector(`[data-grid="${name}"]`)
    if (el) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  }
  const { fine, coarse } = gridSteps(view.k)
  const tile = (name: string, step: number): void => {
    const size = step * view.k
    set(name, { x: text(view.x - 0.5), y: text(view.y - 0.5), width: text(size), height: text(size) })
    set(`${name}-path`, { d: `M0.5 0 V${text(size)} M0 0.5 H${text(size)}` })
  }
  tile('coarse', coarse)
  if (fine !== null) tile('fine', fine)
  set('fine-rect', { display: fine === null ? 'none' : 'inline' })
  set('axis-v', { x1: text(view.x), x2: text(view.x) })
  set('axis-u', { y1: text(view.y), y2: text(view.y) })
}
