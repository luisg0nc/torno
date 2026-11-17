import { MAX_STROKE_POINTS, type SketchSnap } from '../../../shared/marks'
import { simplify } from '../simplify'
import { type Snap, toSketchSnap } from './snap'

// The pens of a sketch, as a state machine the tool feeds pointer events and keys. It holds no scene and draws nothing: its
// points are in the plane's own axes (`[u, v]`) for a stroke on a plane and in the object frame (`[x, y, z]`) for one on the
// surface, whichever the tool gives it, in millimetres. A finished stroke goes to the callback.
//
//   free    press, drag, release. Simplified on release (0.2 mm, at most 400 points); under 0.1 mm it is nothing.
//   line    press, drag, release; or a click and a click. Two points.
//   points  a click adds a point; Enter ends the stroke; Backspace takes the last point back.
//
// A number typed while a segment is drawn (`typedLength`) is its length from its start, along the way the pointer points;
// the pointer still turns it. Enter fixes it: it ends a line, and adds the point to a point-to-point stroke, which another
// Enter ends.

export type Pen = 'free' | 'line' | 'points'
/** What a point snapped to, and whether it was put on the plane (`projectOnto`). */
export interface PenSnap {
  snap: Snap
  projected: boolean
}
/** A finished stroke: its pen, its points, and the snaps of those of them that snapped, by number. */
export interface PenStroke<P extends number[]> {
  pen: Pen
  points: P[]
  snaps: SketchSnap[]
}

/** The shortest a freehand or line stroke is, mm: under it is a touch and not a stroke. */
export const MIN_STROKE_MM = 0.1
/** What freehand is simplified by, mm. */
export const SIMPLIFY_MM = 0.2

const distance = (a: number[], b: number[]): number => Math.hypot(...a.map((c, i) => c - b[i]))
const length = (points: number[][]): number => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0)

export class PenState<P extends number[] = [number, number]> {
  pen: Pen
  private fixed: P[] = []
  private snapped: Array<PenSnap | undefined> = []
  /** Where the pointer is, and what it would snap to there. */
  private pointer: P | null = null
  private pointerSnap: PenSnap | undefined
  private typed: number | null = null
  /** A line is being dragged (the button is down). */
  private dragging = false

  constructor(pen: Pen, private readonly onStroke: (stroke: PenStroke<P>) => void) {
    this.pen = pen
  }

  /** Another pen; a stroke under way is given up. */
  setPen(pen: Pen): void {
    this.cancel()
    this.pen = pen
  }

  /** Gives up the stroke under way. */
  cancel(): void {
    this.fixed = []
    this.snapped = []
    this.pointer = null
    this.pointerSnap = undefined
    this.typed = null
    this.dragging = false
  }

  /** Whether a stroke is under way. */
  get active(): boolean {
    return this.fixed.length > 0
  }

  /** What is drawn so far, with the point the pointer is at (or the typed length) as its end where a segment is being drawn. */
  get points(): P[] {
    const end = this.end()
    return end ? [...this.fixed, end] : [...this.fixed]
  }

  /** The segment being drawn: where it starts, where it ends, its length in mm and, of a plane, its angle in degrees from the plane's `u` axis. Null when none is. */
  get segment(): { from: P; to: P; length: number; angle?: number } | null {
    const end = this.end()
    if (!end || this.pen === 'free') return null
    const from = this.fixed[this.fixed.length - 1]
    const angle = from.length === 2 ? (Math.atan2(end[1] - from[1], end[0] - from[0]) * 180) / Math.PI + 0 : undefined
    return { from: [...from] as P, to: end, length: distance(from, end), ...(angle === undefined ? {} : { angle }) }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The pointer.

  down(p: P, snap?: PenSnap): void {
    if (this.pen === 'free') {
      this.cancel()
      this.fixed = [[...p] as P]
      this.snapped = [snap]
      this.dragging = true
    } else if (this.pen === 'line') {
      if (this.fixed.length === 1) {
        // The second click of a click, click.
        this.move(p, snap)
        this.finishLine()
      } else {
        this.cancel()
        this.fixed = [[...p] as P]
        this.snapped = [snap]
        this.dragging = true
      }
    }
  }

  move(p: P, snap?: PenSnap): void {
    this.pointer = [...p] as P
    this.pointerSnap = snap
    if (this.pen === 'free' && this.dragging) {
      this.fixed.push([...p] as P)
      this.snapped.push(snap)
    }
  }

  up(): void {
    if (!this.dragging) return
    this.dragging = false
    if (this.pen === 'free') this.finishFree()
    // A line with no length yet was a click: it waits for the second one.
    else if (this.pen === 'line' && this.segmentLength() >= MIN_STROKE_MM) this.finishLine()
  }

  click(p: P, snap?: PenSnap): void {
    if (this.pen === 'line') {
      this.down(p, snap)
      this.up()
    } else if (this.pen === 'points') {
      this.move(p, snap)
      if (this.fixed.length === 0) {
        this.fixed = [[...p] as P]
        this.snapped = [snap]
      } else this.addPoint()
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The keys.

  /** Fixes a typed length; with none, ends a line or a point-to-point stroke. */
  enter(): void {
    if (this.pen === 'line') {
      if (this.fixed.length === 1) this.finishLine()
    } else if (this.pen === 'points') {
      if (this.typed !== null && this.end()) this.addPoint()
      else this.finishPoints()
    }
  }

  /** Takes back the last point of a point-to-point stroke; gives up a line before its second point. */
  backspace(): void {
    this.typed = null
    if (this.pen === 'points' && this.fixed.length > 1) {
      this.fixed.pop()
      this.snapped.pop()
    } else if (this.pen !== 'free') this.cancel()
  }

  /** The length of the segment being drawn, mm, kept while the pointer turns it; null lets go of it. */
  typedLength(mm: number | null): void {
    if (mm === null) this.typed = null
    else if (Number.isFinite(mm) && mm > 0 && this.fixed.length > 0 && this.pen !== 'free') this.typed = mm
  }

  // ---------------------------------------------------------------------------------------------------------------------

  /** The point the segment being drawn ends at: the typed length along the pointer's direction, else the pointer. */
  private end(): P | null {
    if (this.pen === 'free' || this.fixed.length === 0 || !this.pointer) return null
    if (this.typed === null) return [...this.pointer] as P
    const from = this.fixed[this.fixed.length - 1]
    const d = distance(this.pointer, from)
    // Where the pointer is on the start, any way will do: the last segment's, else the first axis.
    const toward = d > 1e-9 ? this.pointer.map((c, i) => (c - from[i]) / d) : this.fixed.length > 1 ? this.direction() : from.map((_, i) => (i === 0 ? 1 : 0))
    return from.map((c, i) => c + toward[i] * (this.typed as number)) as P
  }

  private direction(): number[] {
    const [a, b] = [this.fixed[this.fixed.length - 2], this.fixed[this.fixed.length - 1]]
    const d = distance(a, b)
    return b.map((c, i) => (c - a[i]) / d)
  }

  private segmentLength(): number {
    const end = this.end()
    return end ? distance(this.fixed[0], end) : 0
  }

  /** The snap of the end point, none where its place was set by a typed length. */
  private endSnap(): PenSnap | undefined {
    return this.typed === null ? this.pointerSnap : undefined
  }

  private addPoint(): void {
    const end = this.end()
    if (!end || this.fixed.length >= MAX_STROKE_POINTS) return
    this.snapped.push(this.endSnap())
    this.fixed.push(end)
    this.typed = null
  }

  private finishPoints(): void {
    // The point under the pointer is not one until it is clicked.
    if (this.fixed.length > 0) this.emit('points', this.fixed, this.snapped)
    this.cancel()
  }

  private finishLine(): void {
    const end = this.end()
    if (end && this.segmentLength() >= MIN_STROKE_MM) this.emit('line', [this.fixed[0], end], [this.snapped[0], this.endSnap()])
    this.cancel()
  }

  private finishFree(): void {
    const points = this.fixed
    if (length(points) >= MIN_STROKE_MM) {
      const kept = simplify(points, SIMPLIFY_MM, MAX_STROKE_POINTS)
      const was = new Map(points.map((p, i) => [p, i]))
      this.emit('free', kept, kept.map((p) => this.snapped[was.get(p) as number]))
    }
    this.cancel()
  }

  private emit(pen: Pen, points: P[], snaps: Array<PenSnap | undefined>): void {
    const told: SketchSnap[] = []
    snaps.forEach((s, i) => {
      if (s) told.push(toSketchSnap(i, s.snap, s.projected))
    })
    this.onStroke({ pen, points: points.map((p) => [...p] as P), snaps: told })
  }
}
