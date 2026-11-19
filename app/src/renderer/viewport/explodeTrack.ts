import type { Pt } from '../../shared/leader'

export type Vec3 = readonly [number, number, number]
export interface Box3 {
  min: Vec3
  max: Vec3
}

/**
 * Where the explode track stands in the object frame: a straight line along one axis, from 0 % at `from` to 100 % at `to`,
 * beside the parts and outside their box. It is a gauge, drawn on the overlay and no part of the scene.
 */
export interface TrackPlan {
  axis: 0 | 1 | 2
  from: Vec3
  to: Vec3
  /**
   * Set when no place beside the parts has the whole track on screen: the track then stands at a fixed place of the view
   * (`fixedTrack`), its foot `a` and its top `b` in px of the view, and `from` and `to` are only the best place it had.
   */
  screen?: { a: Pt; b: Pt }
}

/** The view the track must stay whole in, in px of the pane. */
export interface TrackView {
  width: number
  height: number
}

/** What the track keeps clear at each edge of the view, in px: the reed and its tools, the ticks' numbers, the scale bar and the hint. */
export const TRACK_CLEAR = { left: 76, top: 28, right: 56, bottom: 72 }
/** How long the fixed track is drawn, at most, in px. */
const FIXED_LENGTH = 180

/** Whether both ends of a track, drawn at `a` and `b`, are inside the view with `TRACK_CLEAR` to spare. */
export function trackFits(a: Pt, b: Pt, view: TrackView): boolean {
  return [a, b].every((p) => p.x >= TRACK_CLEAR.left && p.x <= view.width - TRACK_CLEAR.right && p.y >= TRACK_CLEAR.top && p.y <= view.height - TRACK_CLEAR.bottom)
}

/** The fixed place of the track: the bottom right of the view, standing up, above the scale bar. */
export function fixedTrack(view: TrackView): { a: Pt; b: Pt } {
  const x = view.width - TRACK_CLEAR.right
  const foot = view.height - TRACK_CLEAR.bottom
  const length = Math.max(MIN_TRACK_PX, Math.min(FIXED_LENGTH, foot - TRACK_CLEAR.top))
  return { a: { x, y: foot }, b: { x, y: foot - length } }
}

/** Where the ends of the track are drawn, in px of the view: its fixed place, or where the camera sees its two ends; null where one is behind the camera. */
export function trackEnds(plan: TrackPlan, project: (p: Vec3) => Pt | null): { a: Pt; b: Pt } | null {
  if (plan.screen) return plan.screen
  const [a, b] = [project(plan.from), project(plan.to)]
  return a && b ? { a, b } : null
}

/** Whether two plans are the same place. */
export function samePlan(a: TrackPlan | null, b: TrackPlan | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.axis === b.axis && a.from.join() === b.from.join() && a.to.join() === b.to.join() && JSON.stringify(a.screen ?? null) === JSON.stringify(b.screen ?? null)
}

/** The box a track takes with its handle and the numbers beside it, in px of the view: what a tag stands clear of. */
export function trackBox(ends: { a: Pt; b: Pt }): { x: number; y: number; w: number; h: number } {
  const [x0, x1] = [Math.min(ends.a.x, ends.b.x) - 12, Math.max(ends.a.x, ends.b.x) + 40]
  const [y0, y1] = [Math.min(ends.a.y, ends.b.y) - 12, Math.max(ends.a.y, ends.b.y) + 12]
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The shortest the track is drawn on screen, in px: seen shorter (edge on) it is not drawn and its tag docks. */
export const MIN_TRACK_PX = 72
/** How far outside the box it stands, as a share of the box's largest side. */
const MARGIN = 0.12
/** A corner kept from the frame before is let go of only when another is this much better, in px: the track does not hop while the camera turns. */
const KEEP_PX = 16
/** Up first (the track stands like a ruler), then the other two. */
const AXES = [2, 0, 1] as const

const same = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/**
 * The track of a layout whose parts lie in `box` (as built), for the camera `project` stands for (pixels, null behind it).
 * Along Z when that shows at least `MIN_TRACK_PX`, else along the axis that shows longest. Each axis has four places beside the box;
 * for Z it takes the one drawn furthest right, for X or Y the one drawn lowest, and keeps `previous` while that is about as good.
 * The whole track is on screen (`trackFits`, with `view`); where no place beside the parts has it so (zoomed in), it stands at a fixed
 * place (`fixedTrack`). Null when no axis shows long enough, or nothing can be projected.
 */
export function planTrack(box: Box3, project: (p: Vec3) => Pt | null, previous: TrackPlan | null, view?: TrackView): TrackPlan | null {
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i])
  const length = Math.max(...size)
  if (!(length > 0)) return null
  const margin = MARGIN * length
  type Candidate = TrackPlan & { px: number; score: number; fits: boolean }
  const along = (axis: 0 | 1 | 2): Candidate[] => {
    const [u, v] = [0, 1, 2].filter((i) => i !== axis)
    const out: Candidate[] = []
    for (const lo of [true, false]) {
      for (const lo2 of [true, false]) {
        const from = [0, 0, 0]
        from[axis] = box.min[axis]
        from[u] = lo ? box.min[u] - margin : box.max[u] + margin
        from[v] = lo2 ? box.min[v] - margin : box.max[v] + margin
        const to = [...from]
        to[axis] = box.min[axis] + length
        const a = project(from as unknown as Vec3)
        const b = project(to as unknown as Vec3)
        if (!a || !b) continue
        out.push({ axis, from: from as unknown as Vec3, to: to as unknown as Vec3, px: Math.hypot(b.x - a.x, b.y - a.y), score: axis === 2 ? a.x : a.y, fits: !view || trackFits(a, b, view) })
      }
    }
    return out
  }
  const options = AXES.map((axis) => along(axis).filter((c) => c.px >= MIN_TRACK_PX))
  // A place with the whole track on screen; else, with a track long enough but none of it whole, a fixed place in the view.
  const found = options.map((o) => o.filter((c) => c.fits)).find((o) => o.length > 0)
  if (!found) {
    const any = options.find((o) => o.length > 0)
    return any && view ? { axis: any[0].axis, from: any[0].from, to: any[0].to, screen: fixedTrack(view) } : null
  }
  const best = found.reduce((x, y) => (y.score > x.score ? y : x))
  const kept = previous && found.find((c) => c.axis === previous.axis && same(c.from, previous.from))
  const chosen = kept && kept.score >= best.score - KEEP_PX ? kept : best
  return { axis: chosen.axis, from: chosen.from, to: chosen.to }
}

/** The point of the track at `t` (0 at its foot, 1 at its top), in the object frame. */
export function trackPoint(plan: TrackPlan, t: number): Vec3 {
  return [0, 1, 2].map((i) => plan.from[i] + (plan.to[i] - plan.from[i]) * t) as unknown as Vec3
}

/** How far along the track a pointer is, as drawn from `a` (0 %) to `b` (100 %): its foot of the perpendicular, held between 0 and 1. */
export function amountAlong(a: Pt, b: Pt, at: Pt): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const square = dx * dx + dy * dy
  if (square === 0) return 0
  return Math.min(1, Math.max(0, ((at.x - a.x) * dx + (at.y - a.y) * dy) / square))
}
