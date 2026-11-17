import { number } from '../../../shared/format'
import type { PlaneSnap } from '../../../shared/tracings'

// What the Trace tool snaps to: the exact corners of the cut, the centres of its holes, and the model's vertices that lie in the
// plane (or, drawn fainter, are projected onto it). Within `SNAP_PX` pixels of the pointer; Ctrl held means no snap, as in a sketch.

/** How near, in pixels of the screen, the pointer must be to a point for it to be taken. */
export const SNAP_PX = 10

export interface Snapped {
  /** The point taken: the snap's own, in mm. */
  uv: [number, number]
  snap: PlaneSnap
  /** What it snapped to, for the hint beside the pointer. */
  hint: string
}

/** The word for a snap, as the pointer's hint says it: `corner of the cut`, `hole centre head/E14 ⌀16`, `vertex block/V3 (projected)`. */
export function snapHint(snap: PlaneSnap): string {
  if (snap.kind === 'corner') return 'corner of the cut'
  if (snap.kind === 'centre') return `hole centre ${snap.edge === undefined ? `of ${snap.part}` : `${snap.part}/${snap.edge}`} ⌀${number(2 * snap.radius)}`
  return `vertex ${snap.ref}${snap.projected ? ' (projected)' : ''}`
}

/** Which is taken when two are as near: what is exact before what is not, a corner of the cut first, a projected vertex last. */
const RANK: Record<PlaneSnap['kind'], number> = { corner: 0, centre: 1, vertex: 2 }
const rank = (s: PlaneSnap): number => RANK[s.kind] + (s.kind === 'vertex' && s.projected ? 1 : 0)

/**
 * The snap under the pointer, or null for none: `snaps` are in mm, `uv` is the pointer's point in mm and `pxPerMm` how large a
 * millimetre is on screen, so that the reach is the same ten pixels at any zoom. The nearest within the reach is taken; among
 * points at the same place the exact ones come first. With `ctrl` held, nothing is taken.
 */
export function snapAt(snaps: readonly PlaneSnap[], uv: readonly [number, number], pxPerMm: number, ctrl: boolean): Snapped | null {
  if (ctrl || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1]) || !(pxPerMm > 0)) return null
  const reach = SNAP_PX / pxPerMm
  let best: PlaneSnap | null = null
  let bestAway = Infinity
  for (const snap of snaps) {
    const away = Math.hypot(snap.uv[0] - uv[0], snap.uv[1] - uv[1])
    if (away > reach) continue
    if (best === null || away < bestAway - 1e-9 || (Math.abs(away - bestAway) <= 1e-9 && rank(snap) < rank(best))) {
      best = snap
      bestAway = away
    }
  }
  return best === null ? null : { uv: [best.uv[0], best.uv[1]], snap: best, hint: snapHint(best) }
}
