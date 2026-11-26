import { number } from '../../shared/format'
import { isSize } from '../../shared/params'
import type { Outline, ShelfBox, ShelfPart } from '../../shared/shelf'
import { ruleKindOf, type RuleKind } from './shelf'

// The drawing of an opened part (#352), laid out in pixels from the kernel's outlines and numbers and nothing else: the part through a
// panel at its hole (the panel a 2 mm slab, z in [-2, 0], with a gap where the cutout crosses it), the keep-out dashed, the cutout from
// above, and four dimensions. A dimension's line style comes from the one size of the part that has its value (`dimStyle`). Pure: the
// SVG is ui/shelf/PartDrawing.tsx, which draws what this says.

/** The panel's thickness in the drawing, mm: the panel is `z` from `-SLAB` to 0. */
export const SLAB = 2
/** The box the drawing is laid out in, px; the SVG scales to its column. */
export const DRAWING_SIZE = { width: 600, height: 360 }
/** The most px a mm: a tiny insert is not drawn huge. */
export const MAX_SCALE = 16

/** What a dimension's line says of its number: `ck` checked on the part, `as` assumed, `mo` worked out from the others, `so` with a source, `plain` when no one size (or more than one) is the number. */
export type DimStyle = RuleKind | 'plain'

export interface Seg {
  x1: number
  y1: number
  x2: number
  y2: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** One dimension drawn in one place: its line, its extension lines, where its words stand (`anchor` is the end that is at x) and, when checked, where its ring tick goes. */
export interface Placed {
  line: Seg
  ext: Seg[]
  text: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
  mark?: { x: number; y: number }
}

export interface Dim {
  kind: 'cutout' | 'above' | 'below' | 'width'
  /** `Ø 7.2`, `33.4 × 18.4`, `15`: millimetres, as `format.number` says them. */
  text: string
  /** The number the line measures (a window's width), mm, in full. */
  value: number
  /** The one size of the part with that value, null when it has none or more than one. */
  param: string | null
  style: DimStyle
  /** On the side section; null for none. */
  side: Placed | null
  /** The cutout's is also under the plan. */
  plan?: Placed
}

export interface PartLayout {
  width: number
  height: number
  /** Px a mm of the side section. */
  scale: number
  /** The panel's top at the part's x = 0, px. */
  origin: { x: number; y: number }
  panels: Rect[]
  /** The body's section as one path (`fill-rule: evenodd`). */
  body: string
  /** The keep-out's section; null for none. */
  keep: string | null
  panelLabel: { x: number; y: number }
  keepLabel: { x: number; y: number } | null
  dims: Dim[]
  /** The cutout from above; null for a part with no cutout. */
  plan: {
    scale: number
    sheet: Rect
    label: { x: number; y: number }
    cutout: string
    keep: string | null
    centre: { x: number; y: number }
    lines: Seg[]
  } | null
}

const EPS = 1e-6
const MARGIN = 14
const TOP = 46 // above the part: the cutout's dimension and its words
const BOTTOM = 44 // below it: the body's width and its words
const SIDE_ROOM = 380
const PLAN_CENTRE_X = 500
const SHEET = 116
const GAP_LEFT = 26 // from the part to the depth's line, and from it to its words
const GAP_RIGHT = 28
const WORD = 7.5 // px a character of a dimension's words

const round = (v: number): number => Math.round(v * 1000) / 1000
const rounded = (v: number): string => String(round(v))
const solid = (o: Outline): boolean => o.points.length > 2

function pathOf(outlines: Outline[], at: (x: number, y: number) => [number, number]): string {
  return outlines
    .filter(solid)
    .map((o) => `M${o.points.map(([x, y]) => at(x, y)).map(([a, b]) => `${rounded(a)} ${rounded(b)}`).join('L')}Z`)
    .join('')
}

/** A polygon cut to z in [lo, hi] (Sutherland-Hodgman, the two edges in turn). */
function clipStrip(points: Array<[number, number]>, lo: number, hi: number): Array<[number, number]> {
  const edge = (poly: Array<[number, number]>, inside: (p: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: Array<[number, number]> = []
    poly.forEach((b, i) => {
      const a = poly[(i + poly.length - 1) % poly.length]
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b))
        out.push(b)
      } else if (inside(a)) out.push(cut(a, b))
    })
    return out
  }
  const at = (z: number) => (a: [number, number], b: [number, number]): [number, number] => [a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]), z]
  return edge(edge(points, (p) => p[1] >= lo, at(lo)), (p) => p[1] <= hi, at(hi))
}

/** The style of a number: that of the one size of the part whose default equals it (to a millionth), `plain` when none or several do. */
export function dimStyle(part: Pick<ShelfPart, 'params' | 'checked'>, value: number): { param: string | null; style: DimStyle } {
  const same = part.params.filter((p) => isSize(p) && Math.abs((p.default as number) - value) < EPS)
  if (same.length !== 1) return { param: null, style: 'plain' }
  return { param: same[0].name, style: ruleKindOf(part, same[0]) }
}

const SURE: RuleKind[] = ['as', 'mo', 'so', 'ck']

const bounds = (outlines: Outline[]): { x0: number; y0: number; x1: number; y1: number } | null => {
  const pts = outlines.flatMap((o) => o.points)
  if (pts.length === 0) return null
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) }
}

/**
 * The part laid out in `DRAWING_SIZE`, or null when it has no body to draw (it did not build). The scale is the largest, up to `MAX_SCALE`,
 * at which the part, its keep-out and the room each dimension's words need all fit; the plan has a scale of its own.
 */
export function layoutPart(part: ShelfPart, size: { width: number; height: number } = DRAWING_SIZE): PartLayout | null {
  const body = part.body
  if (!body || !body.side.some(solid)) return null
  const { width: W, height: H } = size
  const bb: ShelfBox = body.bbox
  const keep = part.keepout
  const cut = part.cutout

  // The section of the part, mm. The gap in the panel is the cutout's side section cut to the slab.
  const xMin = Math.min(bb.min[0], keep?.bbox.min[0] ?? Infinity)
  const xMax = Math.max(bb.max[0], keep?.bbox.max[0] ?? -Infinity)
  const zTop = Math.max(bb.max[2], keep?.bbox.max[2] ?? -Infinity, 0)
  const zLow = Math.min(bb.min[2], keep?.bbox.min[2] ?? Infinity)
  const zBot = Math.min(zLow, -SLAB)
  let gap: [number, number] | null = null
  if (cut) {
    const clipped = cut.side.filter((o) => solid(o) && !o.hole).flatMap((o) => clipStrip(o.points, -SLAB, 0))
    if (clipped.length > 0) gap = [Math.min(...clipped.map((p) => p[0])), Math.max(...clipped.map((p) => p[0]))]
    else {
      const half = ('d' in cut.size ? cut.size.d : cut.size.w) / 2
      gap = [-half, half]
    }
  }
  const room = Math.max(5, (xMax - xMin) * 0.55)
  const panelX: [number, number] = [Math.min(xMin - room, 0), Math.max(xMax + room, 0)]

  const above = bb.max[2] > EPS
  const below = bb.min[2] < -EPS
  const words = (text: string): number => text.length * WORD
  const cutText = cut ? ('d' in cut.size ? `Ø ${number(cut.size.d)}` : `${number(cut.size.w)} × ${number(cut.size.h)}`) : ''
  const aboveText = number(bb.max[2])
  const belowText = number(-bb.min[2])
  const widthText = number(bb.max[0] - bb.min[0])

  // The largest scale at which it all fits: the left and the right of the part's x = 0 each need the larger of the panel and the
  // part with its dimension's line and words, and the height needs the room above and below for the cutout's and the width's.
  const sideRoom = cut ? SIDE_ROOM : W
  const topRoom = cut ? TOP : 18
  const need = (s: number): { left: number; right: number; up: number } => ({
    left: Math.max(-panelX[0] * s, below ? -xMin * s + GAP_LEFT + 8 + words(belowText) : 0),
    right: Math.max(panelX[1] * s, above ? xMax * s + GAP_RIGHT + 8 + words(aboveText) + 18 : 0),
    up: (zTop - zBot) * s
  })
  const fits = (s: number): boolean => {
    const n = need(s)
    return n.left + n.right <= sideRoom - 2 * MARGIN && n.up <= H - 2 * MARGIN - topRoom - BOTTOM
  }
  let lo = 0.01
  let hi = MAX_SCALE
  if (fits(hi)) lo = hi
  else for (let i = 0; i < 40; i++) fits((lo + hi) / 2) ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2)
  const s = lo
  const n = need(s)
  const ox = (sideRoom - (n.left + n.right)) / 2 + n.left
  const y0 = (H - (n.up + topRoom + BOTTOM)) / 2
  const oy = y0 + topRoom + zTop * s
  const sx = (x: number): number => ox + x * s
  const sz = (z: number): number => oy - z * s
  const side = (x: number, z: number): [number, number] => [sx(x), sz(z)]

  // The panel: a slab, in two when the cutout cuts it.
  const slabTop = sz(0)
  const panels: Rect[] = gap
    ? [
        { x: sx(panelX[0]), y: slabTop, w: sx(gap[0]) - sx(panelX[0]), h: SLAB * s },
        { x: sx(gap[1]), y: slabTop, w: sx(panelX[1]) - sx(gap[1]), h: SLAB * s }
      ]
    : [{ x: sx(panelX[0]), y: slabTop, w: sx(panelX[1]) - sx(panelX[0]), h: SLAB * s }]

  const style = (value: number, second?: number): { param: string | null; style: DimStyle } => {
    const one = dimStyle(part, value)
    if (second === undefined) return one
    const two = dimStyle(part, second)
    const kinds = [one.style, two.style]
    if (kinds.includes('plain')) return { param: null, style: 'plain' }
    const least = SURE.find((k) => kinds.includes(k))!
    return one.style === two.style ? one : { param: null, style: least }
  }
  const ring = (placed: Placed, ck: boolean, at: { x: number; y: number }): Placed => (ck ? { ...placed, mark: at } : placed)

  const dims: Dim[] = []

  // The cutout's size, over the top: the gap's edges carried up by extension lines.
  let planDim: Placed | undefined
  const sheet = (() => {
    if (!cut) return null
    const all = [...cut.plan, ...(keep?.plan ?? [])]
    const box = bounds(all) ?? { x0: -1, y0: -1, x1: 1, y1: 1 }
    const cx = (box.x0 + box.x1) / 2
    const cy = (box.y0 + box.y1) / 2
    const half = Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2 * 1.25 + 0.6
    const ps = Math.min(MAX_SCALE, SHEET / 2 / half)
    return { ps, cx, cy, rect: { x: PLAN_CENTRE_X - SHEET / 2, y: 54, w: SHEET, h: SHEET } }
  })()
  if (cut && gap) {
    const y = sz(zTop) - 24
    const mid = (sx(gap[0]) + sx(gap[1])) / 2
    const text = { x: mid, y: y - 7, anchor: 'middle' as const }
    const placed: Placed = {
      line: { x1: sx(gap[0]), y1: y, x2: sx(gap[1]), y2: y },
      ext: [gap[0], gap[1]].map((x) => ({ x1: sx(x), y1: slabTop - 2, x2: sx(x), y2: y - 4 })),
      text
    }
    const value = 'd' in cut.size ? cut.size.d : cut.size.w
    const { param, style: kind } = 'd' in cut.size ? style(cut.size.d) : style(cut.size.w, cut.size.h)
    if (sheet) {
      const plan = bounds(cut.plan)
      const half = plan ? { x0: plan.x0, x1: plan.x1 } : { x0: -value / 2, x1: value / 2 }
      const px = (x: number): number => PLAN_CENTRE_X + (x - sheet.cx) * sheet.ps
      const py = sheet.rect.y + sheet.rect.h + 18
      planDim = {
        line: { x1: px(half.x0), y1: py, x2: px(half.x1), y2: py },
        ext: [half.x0, half.x1].map((x) => ({ x1: px(x), y1: sheet.rect.y + sheet.rect.h - 2, x2: px(x), y2: py + 4 })),
        text: { x: (px(half.x0) + px(half.x1)) / 2, y: py + 16, anchor: 'middle' }
      }
      planDim = ring(planDim, kind === 'ck', { x: planDim.text.x + words(cutText) / 2 + 12, y: planDim.text.y - 4 })
    }
    dims.push({
      kind: 'cutout',
      text: cutText,
      value,
      param,
      style: kind,
      side: ring(placed, kind === 'ck', { x: mid + words(cutText) / 2 + 12, y: y - 11 }),
      ...(planDim ? { plan: planDim } : {})
    })
  }

  // The height above the panel, at the right of the part: from the panel's top to the highest point.
  if (above) {
    const right = Math.max(bb.max[0], keep?.bbox.max[0] ?? -Infinity)
    const x = sx(right) + GAP_RIGHT
    const topPoints = body.side.flatMap((o) => o.points).filter((p) => Math.abs(p[1] - bb.max[2]) < 1e-3)
    const topRight = topPoints.length > 0 ? Math.max(...topPoints.map((p) => p[0])) : bb.max[0]
    const mid = (sz(0) + sz(bb.max[2])) / 2
    const { param, style: kind } = style(bb.max[2])
    const placed: Placed = {
      line: { x1: x, y1: sz(0), x2: x, y2: sz(bb.max[2]) },
      ext: [
        { x1: sx(topRight), y1: sz(bb.max[2]), x2: x + 3, y2: sz(bb.max[2]) },
        { x1: sx(gap ? gap[1] : bb.max[0]), y1: sz(0), x2: x + 3, y2: sz(0) }
      ],
      text: { x: x + 8, y: mid + 4, anchor: 'start' }
    }
    dims.push({ kind: 'above', text: aboveText, value: bb.max[2], param, style: kind, side: ring(placed, kind === 'ck', { x: x + 8 + words(aboveText) + 12, y: mid }) })
  }

  // The depth below the panel, at the left: from the panel's top to the lowest point of the part.
  if (below) {
    const left = Math.min(bb.min[0], keep?.bbox.min[0] ?? Infinity)
    const x = sx(left) - GAP_LEFT
    const lowPoints = body.side.flatMap((o) => o.points).filter((p) => Math.abs(p[1] - bb.min[2]) < 1e-3)
    const lowLeft = lowPoints.length > 0 ? Math.min(...lowPoints.map((p) => p[0])) : bb.min[0]
    const mid = (sz(0) + sz(bb.min[2])) / 2
    const { param, style: kind } = style(-bb.min[2])
    const placed: Placed = {
      line: { x1: x, y1: sz(0), x2: x, y2: sz(bb.min[2]) },
      ext: [
        { x1: sx(lowLeft), y1: sz(bb.min[2]), x2: x - 3, y2: sz(bb.min[2]) },
        { x1: sx(gap ? gap[0] : bb.min[0]), y1: sz(0), x2: x - 3, y2: sz(0) }
      ],
      text: { x: x - 8, y: mid + 4, anchor: 'end' }
    }
    dims.push({ kind: 'below', text: belowText, value: -bb.min[2], param, style: kind, side: ring(placed, kind === 'ck', { x: x - 8 - words(belowText) - 12, y: mid }) })
  }

  // The body's width, under the part.
  {
    const y = sz(zLow) + 22
    const mid = (sx(bb.min[0]) + sx(bb.max[0])) / 2
    const { param, style: kind } = style(bb.max[0] - bb.min[0])
    const placed: Placed = {
      line: { x1: sx(bb.min[0]), y1: y, x2: sx(bb.max[0]), y2: y },
      ext: [bb.min[0], bb.max[0]].map((x) => ({ x1: sx(x), y1: sz(bb.min[2]) + 2, x2: sx(x), y2: y + 4 })),
      text: { x: mid, y: y + 17, anchor: 'middle' }
    }
    dims.push({ kind: 'width', text: widthText, value: bb.max[0] - bb.min[0], param, style: kind, side: ring(placed, kind === 'ck', { x: mid + words(widthText) / 2 + 12, y: y + 13 }) })
  }

  const plan = sheet && cut
    ? (() => {
        const px = (x: number, y: number): [number, number] => [PLAN_CENTRE_X + (x - sheet.cx) * sheet.ps, sheet.rect.y + sheet.rect.h / 2 - (y - sheet.cy) * sheet.ps]
        const c = bounds(cut.plan)
        const [cx, cy] = c ? px((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2) : px(sheet.cx, sheet.cy)
        const reach = c ? Math.min(30, Math.max((c.x1 - c.x0), (c.y1 - c.y0)) * sheet.ps * 0.5 + 8) : 30
        return {
          scale: sheet.ps,
          sheet: sheet.rect,
          label: { x: PLAN_CENTRE_X, y: sheet.rect.y - 12 },
          cutout: pathOf(cut.plan, px),
          keep: keep && keep.plan.some(solid) ? pathOf(keep.plan, px) : null,
          centre: { x: cx, y: cy },
          lines: [
            { x1: cx - reach, y1: cy, x2: cx + reach, y2: cy },
            { x1: cx, y1: cy - reach, x2: cx, y2: cy + reach }
          ]
        }
      })()
    : null

  const keepRight = keep ? keep.bbox.max[0] : null
  return {
    width: W,
    height: H,
    scale: s,
    origin: { x: ox, y: oy },
    panels,
    body: pathOf(body.side, side),
    keep: keep && keep.side.some(solid) ? pathOf(keep.side, side) : null,
    panelLabel: { x: sx(panelX[0]), y: slabTop - 7 },
    keepLabel: keep && keepRight !== null && keep.side.some(solid) ? { x: sx(keepRight) + 7, y: sz(keep.bbox.min[2]) - 5 } : null,
    dims,
    plan
  }
}
