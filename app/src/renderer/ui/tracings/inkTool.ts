import { MAX_STROKE_POINTS, type SketchPlane, type SketchSnap } from '../../../shared/marks'
import type { PlaneSnap, Tracing } from '../../../shared/tracings'

// The Ink tool's own state, apart from the screen: a stroke under way in one of the sketch's three pens, and what a press, a move, a
// release, Enter, Backspace and Esc do to it. A finished stroke goes to `finish`, one for each; the ink is a sketch on the tracing's plane
// (`state/sketching.ts` keeps and sends it), so these are the sketch's pens and its snapping, in the tracing's own `[u, v]`. Nothing here is
// held in React: the sheet draws what is under way from `elements` onto the draft layer on every move of the pointer.

export type InkPen = 'free' | 'line' | 'points'

export const INK_PENS: ReadonlyArray<{ pen: InkPen; label: string; title: string }> = [
  { pen: 'free', label: 'Free', title: 'Freehand: press and drag' },
  { pen: 'line', label: 'Line', title: 'Straight line: press and drag, or click its two ends' },
  { pen: 'points', label: 'Point to point', title: 'Point to point: a click for each point, Enter ends it' }
]

/** A finished stroke: its pen, its points in the plane's `[u, v]` (mm) and the snaps of those that snapped to a point main can vouch for. */
export interface InkStroke {
  pen: InkPen
  points2d: [number, number][]
  snaps?: SketchSnap[]
}

/** A point the pointer gives: its place in the plane in mm, and the point of the model it snapped to, if any. */
export interface Pointed {
  uv: [number, number]
  snap?: PlaneSnap
}

/** What a point under way is: its place, and its snap. */
interface Put {
  uv: [number, number]
  snap?: PlaneSnap
}

const free = (n: number): number => Math.round(n * 1e4) / 1e4 + 0
const mm = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)
/** How far a pointer may go between a press and a release for it to be a click, in pixels. */
const CLICK_PX = 3
/** How far apart the points of a freehand stroke are, in pixels. */
const SPACING_PX = 2

/**
 * What a snap says of a point of a stroke, as a sketch keeps it (`SketchSnap`): a vertex by its ref, the centre of a hole by the edge of
 * its circle and its radius, and `projected` for a vertex that lies off the plane and is only where it falls on it. A corner of the cut is
 * exact for the build but is no vertex of the model: it has no ref, and is null (the point is kept as the kernel gave it).
 */
export function inkSnap(snap: PlaneSnap, i: number): SketchSnap | null {
  if (snap.kind === 'vertex') return { i, vertex: snap.ref, ...(snap.projected ? { projected: true as const } : {}) }
  if (snap.kind === 'centre' && snap.edge !== undefined) return { i, centre: `${snap.part}/${snap.edge}`, radius: snap.radius }
  return null
}

/** The sketch plane ink on `tracing` is drawn in: the tracing's own frame, made from it. */
export function inkPlane(tracing: Pick<Tracing, 'id' | 'plane'>): SketchPlane {
  const { origin, x, y, label } = tracing.plane
  return { id: 1, origin: [origin[0], origin[1], origin[2]], x: [x[0], x[1], x[2]], y: [y[0], y[1], y[2]], label, from: { kind: 'tracing', tracing: tracing.id } }
}

/** At most `most` of `points`, the first and the last always among them, evenly spaced along the list. */
function thinned<T>(points: readonly T[], most: number): T[] {
  if (points.length <= most) return [...points]
  return Array.from({ length: most }, (_, i) => points[Math.round((i * (points.length - 1)) / (most - 1))])
}

export class InkTool {
  pen: InkPen = 'free'
  private points: Put[] = []
  /** A press is held: a freehand stroke being drawn, or the first end of a line that may be dragged. */
  private down = false
  /** Where a line began, for judging whether its release was a click. */
  private from: [number, number] | null = null

  constructor(
    private readonly finish: (stroke: InkStroke) => void,
    private readonly changed: () => void = () => {}
  ) {}

  /** What is under way, as the points put down so far. */
  get draft(): [number, number][] {
    return this.points.map((p) => p.uv)
  }

  get active(): boolean {
    return this.points.length > 0
  }

  /** Takes a pen: what is under way is given up. */
  setPen(pen: InkPen): void {
    if (pen === this.pen) return
    this.pen = pen
    this.reset()
    this.changed()
  }

  /** The next pen, round again; the one now in hand. */
  cycle(): InkPen {
    this.setPen(INK_PENS[(INK_PENS.findIndex((p) => p.pen === this.pen) + 1) % INK_PENS.length].pen)
    return this.pen
  }

  private reset(): void {
    this.points = []
    this.down = false
    this.from = null
  }

  private put(at: Pointed): Put {
    return { uv: at.snap ? [at.snap.uv[0], at.snap.uv[1]] : [free(at.uv[0]), free(at.uv[1])], ...(at.snap ? { snap: at.snap } : {}) }
  }

  /** The left button went down on the sheet, `pxPerMm` being how large a millimetre is on screen. */
  press(at: Pointed, pxPerMm: number): void {
    if (!(pxPerMm > 0) || !Number.isFinite(at.uv[0]) || !Number.isFinite(at.uv[1])) return
    const p = this.put(at)
    if (this.pen === 'free') {
      this.points = [p]
      this.down = true
    } else if (this.pen === 'line') {
      const first = this.points[0]
      if (first !== undefined && !this.down) return this.done([first, p])
      this.points = [p]
      this.down = true
      this.from = p.uv
    } else {
      const last = this.points.at(-1)
      // A double click is one point, and a line is not drawn back on itself.
      if (last !== undefined && Math.hypot(p.uv[0] - last.uv[0], p.uv[1] - last.uv[1]) <= 0.5 / pxPerMm) return
      this.points = [...this.points, p]
      if (this.points.length >= MAX_STROKE_POINTS) return this.done(this.points)
    }
    this.changed()
  }

  /** The pointer moved with the button down (a freehand stroke grows). */
  move(at: Pointed, pxPerMm: number): void {
    if (this.pen !== 'free' || !this.down || !(pxPerMm > 0)) return
    const last = this.points.at(-1)
    if (!last || !Number.isFinite(at.uv[0]) || !Number.isFinite(at.uv[1])) return
    const p = this.put({ uv: at.uv })
    if (Math.hypot(p.uv[0] - last.uv[0], p.uv[1] - last.uv[1]) < SPACING_PX / pxPerMm) return
    this.points = [...this.points, p]
    this.changed()
  }

  /** The button came up: a freehand stroke ends, a line pressed and dragged ends, a line pressed and let go waits for its other end. */
  release(at: Pointed, pxPerMm: number): void {
    if (!this.down || !(pxPerMm > 0)) return
    this.down = false
    if (this.pen === 'free') {
      const end = this.put(at)
      const last = this.points.at(-1)
      const far = last !== undefined && Math.hypot(end.uv[0] - last.uv[0], end.uv[1] - last.uv[1]) >= 0.5 / pxPerMm
      const points = far ? [...this.points, end] : this.points
      // The snap of a point between the ends is none: only the first, and the last, can be where the pointer was snapped.
      if (points.length < 2) {
        this.cancel()
        return
      }
      return this.done(points)
    }
    if (this.pen === 'line') {
      const first = this.points[0]
      const end = this.put(at)
      if (this.from !== null && Math.hypot(end.uv[0] - this.from[0], end.uv[1] - this.from[1]) >= CLICK_PX / pxPerMm) return this.done([first, end])
      this.from = null
      this.changed()
    }
  }

  /** Enter: a point to point line of two points or more ends. */
  end(): boolean {
    if (this.pen !== 'points' || this.points.length < 2) return false
    this.done(this.points)
    return true
  }

  /** Backspace: the last point of what is under way taken back. */
  back(): boolean {
    if (this.points.length === 0) return false
    this.points = this.points.slice(0, -1)
    if (this.points.length === 0) this.reset()
    this.changed()
    return true
  }

  /** Esc: all that is under way given up. True when there was something. */
  cancel(): boolean {
    if (!this.active) return false
    this.reset()
    this.changed()
    return true
  }

  private done(points: readonly Put[]): void {
    const kept = thinned(points, MAX_STROKE_POINTS)
    const snaps = kept.flatMap((p, i) => (p.snap ? [inkSnap(p.snap, i)] : [])).filter((s): s is SketchSnap => s !== null)
    this.reset()
    this.changed()
    this.finish({ pen: this.pen, points2d: kept.map((p) => [p.uv[0], p.uv[1]] as [number, number]), ...(snaps.length > 0 ? { snaps } : {}) })
  }

  /**
   * What is under way, as the elements of the draft layer in the sheet's own millimetres (`down` says whether the plane's v runs down the
   * screen): the path so far, to the pointer for a line and a point to point line, a dot on each point, and a ring on a point that snapped.
   */
  elements(hover: readonly [number, number] | null, down: boolean, pxPerMm: number): string {
    if (this.points.length === 0) return ''
    const at = (p: readonly [number, number]): [number, number] => [p[0], down ? p[1] : -p[1]]
    const pt = (p: readonly [number, number]): string => at(p).map(mm).join(' ')
    const dot = 3 / pxPerMm
    const way = this.points.map((p) => p.uv as readonly [number, number])
    const through = this.pen === 'free' || hover === null ? way : [...way, hover]
    const out: string[] = []
    if (through.length > 1) out.push(`<path class="tr-draft-line" d="M${through.map(pt).join(' L')}" fill="none"/>`)
    if (this.pen !== 'free') {
      for (const p of this.points) {
        const [x, y] = at(p.uv)
        out.push(`<circle class="tr-draft-dot" cx="${mm(x)}" cy="${mm(y)}" r="${mm(dot)}"/>`)
      }
    }
    return out.join('')
  }
}
