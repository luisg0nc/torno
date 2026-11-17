import type { Mark, Vec3 } from '../../../shared/marks'
import { type Layer, type LayerShape, type Tracing, toUv } from '../../../shared/tracings'

// What the Select tool does on a sheet: finds the mark or the shape of a layer under the pointer (`hitTest`), and says which of them the
// person may remove (`canRemove`). Pure: the sheet draws what is selected from `selectedElements` onto the draft layer, and the selected
// mark's id is the only thing kept (in the store of tracings); nothing here is held in React.

/** How near, in pixels of the screen, the pointer must be to a mark or a shape to be on it. */
export const HIT_PX = 8

export type Hit = { kind: 'mark'; id: string } | { kind: 'shape'; layer: number; index: number }

type Uv = readonly [number, number]
const mm = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)

/** The distance from `p` to the segment `a` to `b`. */
function toSegment(p: Uv, a: Uv, b: Uv): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** The distance from `p` to the line through `points` (to its closing side as well when `closed`). */
function toLine(p: Uv, points: readonly Uv[], closed = false): number {
  if (points.length === 1) return Math.hypot(p[0] - points[0][0], p[1] - points[0][1])
  let least = Infinity
  const last = closed ? points.length : points.length - 1
  for (let i = 0; i < last; i++) least = Math.min(least, toSegment(p, points[i], points[(i + 1) % points.length]))
  return least
}

/** Where a mark of the tracing is, as lines in the plane's `[u, v]`: its uv as placed when it has them, else worked out from its points. */
function linesOf(mark: Mark, tracing: Pick<Tracing, 'plane'>): Uv[][] {
  const uvOf = (p: Vec3, i: number): Uv => mark.uv?.[i] ?? toUv(tracing.plane, p)
  switch (mark.kind) {
    case 'pin':
    case 'pick':
      return [[uvOf(mark.anchor.point, 0)]]
    case 'arrow':
      return [[uvOf(mark.from.point, 0), uvOf(mark.to, 1)]]
    case 'sketch':
      return mark.strokes.flatMap((stroke) => (stroke.plane !== undefined && stroke.points2d ? [stroke.points2d as Uv[]] : []))
    default:
      return []
  }
}

/**
 * What is under the pointer: the nearest of the marks of `tracing` (a pin by its point, ink by its strokes, an arrow by its line) and
* of the shapes of its visible layers (a line along it, a circle on its ring, a label by its point) within `HIT_PX` pixels of `uv`, `pxPerMm`
 * being how large a millimetre is on screen. A mark is taken before any shape, and a layer above before one beneath.
 */
export function hitTest(marks: readonly Mark[], layers: readonly Layer[], tracing: Pick<Tracing, 'id' | 'plane'>, uv: Uv, pxPerMm: number): Hit | null {
  if (!Number.isFinite(uv[0]) || !Number.isFinite(uv[1]) || !(pxPerMm > 0)) return null
  const reach = HIT_PX / pxPerMm
  let best: Hit | null = null
  let least = Infinity
  const take = (hit: Hit, away: number, bias: number): void => {
    if (away > reach || away + bias >= least) return
    best = hit
    least = away + bias
  }
  for (const mark of marks) {
    if (mark.tracing !== tracing.id) continue
    for (const line of linesOf(mark, tracing)) take({ kind: 'mark', id: mark.id }, toLine(uv, line), 0)
  }
  // A mark is taken before any shape: a pin on a line is the pin. Of the shapes the nearest is, and of two as near the layer above.
  if (best !== null) return best
  const hair = reach * 1e-6
  layers.forEach((layer, order) => {
    if (layer.hidden) return
    layer.shapes.forEach((shape, index) => {
      const hit: Hit = { kind: 'shape', layer: layer.id, index }
      const bias = hair * (1 + layers.length - order)
      if (shape.kind === 'polyline') take(hit, toLine(uv, shape.points, shape.closed === true), bias)
      else if (shape.kind === 'circle') take(hit, Math.abs(Math.hypot(uv[0] - shape.centre[0], uv[1] - shape.centre[1]) - shape.radius), bias)
      else take(hit, Math.hypot(uv[0] - shape.at[0], uv[1] - shape.at[1]), bias)
    })
  })
  return best
}

/** Whether the person may remove a mark with Delete: their own. The agent's is theirs to resolve, not to take away. */
export const canRemove = (mark: Pick<Mark, 'author'>): boolean => mark.author === 'user'

/**
 * The selected mark as the elements of the draft layer in the sheet's own millimetres (`down` says whether the plane's v runs down the
 * screen): a ring round a point, a wide faint line under a stroke. Widths are pixels (`.tr-selected`).
 */
export function selectedElements(mark: Mark, tracing: Pick<Tracing, 'plane'>, down: boolean, pxPerMm: number): string {
  const at = (p: Uv): [number, number] => [p[0], down ? p[1] : -p[1]]
  const out: string[] = []
  for (const line of linesOf(mark, tracing)) {
    if (line.length === 1) {
      const [x, y] = at(line[0])
      out.push(`<circle class="tr-selected" cx="${mm(x)}" cy="${mm(y)}" r="${mm(7 / pxPerMm)}"/>`)
    } else if (line.length > 1) out.push(`<path class="tr-selected tr-selected-line" d="M${line.map((p) => at(p).map(mm).join(' ')).join(' L')}" fill="none"/>`)
  }
  return out.join('')
}

/** The selected shape of a layer as the elements of the draft layer: a halo along a line or a ring, a ring on a label. */
export function selectedShapeElements(shape: LayerShape, down: boolean, pxPerMm: number): string {
  const at = (p: Uv): [number, number] => [p[0], down ? p[1] : -p[1]]
  if (shape.kind === 'polyline') return `<path class="tr-selected tr-selected-line" d="M${shape.points.map((p) => at(p).map(mm).join(' ')).join(' L')}${shape.closed ? ' Z' : ''}" fill="none"/>`
  if (shape.kind === 'circle') {
    const [x, y] = at(shape.centre)
    return `<circle class="tr-selected tr-selected-line" cx="${mm(x)}" cy="${mm(y)}" r="${mm(shape.radius)}" fill="none"/>`
  }
  const [x, y] = at(shape.at)
  return `<circle class="tr-selected" cx="${mm(x)}" cy="${mm(y)}" r="${mm(7 / pxPerMm)}"/>`
}
