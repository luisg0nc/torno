import { fitNumber, number } from '../../../shared/format'
import { fitSimilar, fitStraight, type Lineup, type LineupPair, type LineupSnap, MOST_PAIRS, SIMILAR_NEEDS, STRAIGHT_NEEDS } from '../../../shared/lineup'
import type { PlaneSnap, TracingSidePair } from '../../../shared/tracings'

// The clicks of lining a photo up with a tracing: the same spots on the photo and then on the tracing, in order, each pair numbered `1`,
// `2`, … in one colour on both sides. A click can be moved, and the last one taken away. The tool holds the clicks (the photo's in
// pixels of the kept file, y down; the tracing's in mm, `uv`, with what each snapped to) and never touches the screen: the view
// (`LineUp.tsx`) draws them and forwards the pointer. After a swap the tracing side is kept and only the photo is asked for.

export type Side = 'photo' | 'tracing'

export interface TracingClick {
  uv: [number, number]
  snap?: LineupSnap
}

export class LineupTool {
  photo: Array<[number, number]> = []
  tracing: TracingClick[] = []
  /** Whether a homography is fitted (4 points or more) rather than a similarity. Off until asked for. */
  straighten = false
  /** The sides clicked, in order, so that Backspace takes the last away (the tracing side kept after a swap is in none of it). */
  private order: Side[] = []

  /** The tool for lining up again, starting from what the photo had: each pair complete, and the way it was fitted. */
  static from(pairs: ReadonlyArray<LineupPair | TracingSidePair>, method: 'similar' | 'straight'): LineupTool {
    const tool = new LineupTool()
    tool.straighten = method === 'straight'
    for (const p of pairs) {
      tool.tracing.push({ uv: [p.uv[0], p.uv[1]], ...(p.snap === undefined ? {} : { snap: p.snap }) })
      if ('photo' in p) tool.photo.push([p.photo[0], p.photo[1]])
    }
    // The order of the clicks of a line-up that was made is photo then tracing, pair by pair; a pair with no photo side waits for it.
    for (let i = 0; i < tool.tracing.length; i++) {
      if (i < tool.photo.length) tool.order.push('photo')
      tool.order.push('tracing')
    }
    return tool
  }

  /** The tool for a swapped photo: the tracing's points are kept, and the photo's are asked for, one for each. */
  static swapped(kept: ReadonlyArray<TracingSidePair | LineupPair>): LineupTool {
    const tool = new LineupTool()
    for (const p of kept) tool.tracing.push({ uv: [p.uv[0], p.uv[1]], ...(p.snap === undefined ? {} : { snap: p.snap }) })
    return tool
  }

  /** Which side is clicked next, or null when there are 8 pairs. The photo is asked for while it has no more clicks than the tracing. */
  next(): Side | null {
    if (this.photo.length === this.tracing.length && this.tracing.length >= MOST_PAIRS) return null
    return this.photo.length > this.tracing.length ? 'tracing' : 'photo'
  }

  clickPhoto(p: readonly [number, number]): boolean {
    if (this.next() !== 'photo') return false
    this.photo.push([p[0], p[1]])
    this.order.push('photo')
    return true
  }

  clickTracing(uv: readonly [number, number], snap?: LineupSnap): boolean {
    if (this.next() !== 'tracing') return false
    this.tracing.push({ uv: [uv[0], uv[1]], ...(snap === undefined ? {} : { snap }) })
    this.order.push('tracing')
    return true
  }

  /** Takes the last click away. False with none to take; a swapped photo's kept tracing side is not taken. */
  undo(): boolean {
    const side = this.order.at(-1)
    if (side === undefined) return false
    this.order.pop()
    if (side === 'photo') this.photo.pop()
    else this.tracing.pop()
    return true
  }

  /** Moves a click of the photo to another place. */
  movePhoto(i: number, p: readonly [number, number]): void {
    if (i >= 0 && i < this.photo.length) this.photo[i] = [p[0], p[1]]
  }

  /** Moves a click of the tracing; what it snapped to is only what it is given here, since where it was moved to may snap to nothing. */
  moveTracing(i: number, uv: readonly [number, number], snap?: LineupSnap): void {
    if (i >= 0 && i < this.tracing.length) this.tracing[i] = { uv: [uv[0], uv[1]], ...(snap === undefined ? {} : { snap }) }
  }

  setStraighten(on: boolean): void {
    this.straighten = on
  }

  method(): 'similar' | 'straight' {
    return this.straighten ? 'straight' : 'similar'
  }

  needs(): number {
    return this.straighten ? STRAIGHT_NEEDS : SIMILAR_NEEDS
  }

  /** The pairs both sides of which have been clicked. */
  pairs(): LineupPair[] {
    const n = Math.min(this.photo.length, this.tracing.length)
    return this.tracing.slice(0, n).map((t, i) => ({ photo: [this.photo[i][0], this.photo[i][1]], uv: t.uv, ...(t.snap === undefined ? {} : { snap: t.snap }) }))
  }

  /** Whether Done may be pressed: every click has its partner, and there are as many pairs as the method needs. */
  canDone(): boolean {
    return this.photo.length === this.tracing.length && this.pairs().length >= this.needs() && this.pairs().length <= MOST_PAIRS
  }

  /**
   * What the pairs so far say, for the bar: null with fewer than the method needs, the fit or why it cannot be made. `size` is the photo's
   * width and height and `centre` the middle of the outline, as main fits them on Done.
   */
  fit(size: readonly [number, number], centre?: readonly [number, number]): Lineup | { error: string } | null {
    const pairs = this.pairs()
    if (pairs.length < this.needs()) return null
    return this.straighten ? fitStraight(pairs, { size, ...(centre === undefined ? {} : { centre }) }) : fitSimilar(pairs)
  }

  /** What is wanted next, in words. */
  say(): string {
    if (this.canDone()) return 'Ready: Done lines the photo up'
    const next = this.next()
    if (next === null) return 'Done lines the photo up'
    return `Click point ${(next === 'photo' ? this.photo.length : this.tracing.length) + 1} on the ${next === 'photo' ? 'photo' : 'tracing'}`
  }
}

/** What main is told a click on the tracing snapped to: a corner by its place, a hole centre by its edge or its place, a vertex by its ref; null for a vertex only projected onto the plane. */
export function lineupSnapOf(snap: PlaneSnap): LineupSnap | null {
  if (snap.kind === 'corner') return { corner: [snap.uv[0], snap.uv[1]] }
  if (snap.kind === 'centre') return { centre: snap.edge ?? [snap.uv[0], snap.uv[1]] }
  return snap.projected ? null : { vertex: snap.ref }
}

/** The snaps a line-up click may take: the vertices that are only projected onto the plane are left out. */
export const offeredSnaps = (snaps: readonly PlaneSnap[]): PlaneSnap[] => snaps.filter((s) => lineupSnapOf(s) !== null)

/** The bar: `scale 4.73 px/mm · angle 2.1° · fit 0.4 mm (5 points)`, or `no spare point to check it` when there is no fit. */
export function barText(fit: Lineup, points: number): string {
  const checked = fit.fit === undefined ? 'no spare point to check it' : `fit ${fitNumber(fit.fit)} mm`
  return `scale ${number(fit.scale)} px/mm · angle ${number(fit.angle)}° · ${checked} (${points} ${points === 1 ? 'point' : 'points'})`
}
