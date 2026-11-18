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
 * Null when no axis shows long enough, or nothing can be projected.
 */
export function planTrack(box: Box3, project: (p: Vec3) => Pt | null, previous: TrackPlan | null): TrackPlan | null {
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i])
  const length = Math.max(...size)
  if (!(length > 0)) return null
  const margin = MARGIN * length
  type Candidate = TrackPlan & { px: number; score: number }
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
        out.push({ axis, from: from as unknown as Vec3, to: to as unknown as Vec3, px: Math.hypot(b.x - a.x, b.y - a.y), score: axis === 2 ? a.x : a.y })
      }
    }
    return out
  }
  const options = AXES.map((axis) => along(axis).filter((c) => c.px >= MIN_TRACK_PX))
  const found = options.find((o) => o.length > 0)
  if (!found) return null
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
