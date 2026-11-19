import type { StrokeVector } from '../../../shared/drawing'
import type { Vec3 } from '../../../shared/marks'
import type { Under } from './under'

// An arrow drawn across a face as a vector: the two ends of a pen stroke where it lies over a face, in mm on the
// surface, how long and which way, and a guess at which end carries the head.

/** How much of the path may lie beyond the tip of an arrow: the barbs are short, a loop's way back is not. */
const BARBS = 0.4

type Pt = readonly [number, number]
const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1])
const pathLength = (points: readonly Pt[], from: number, to: number): number => {
  let n = 0
  for (let i = from; i < to; i += 1) n += dist(points[i], points[i + 1])
  return n
}

/** The tip, when the stroke turns back on itself near its end: the point farthest from the first, with the path beyond it short and heading back. */
function tipAtEnd(points: readonly Pt[]): Pt | null {
  if (points.length < 3) return null
  let at = 0
  for (let i = 1; i < points.length; i += 1) if (dist(points[0], points[i]) > dist(points[0], points[at])) at = i
  if (at === 0 || at === points.length - 1) return null
  const tip = points[at]
  // The first later point that is somewhere else than the tip: where the stroke goes from it.
  const next = points.slice(at + 1).find((p) => dist(p, tip) > 0.5)
  if (!next) return null
  const back = (tip[0] - points[0][0]) * (next[0] - tip[0]) + (tip[1] - points[0][1]) * (next[1] - tip[1]) < 0
  const before = pathLength(points, 0, at)
  return back && before > 0 && pathLength(points, at, points.length - 1) <= BARBS * before ? tip : null
}

/** Which end of a pen stroke carries the head of an arrow, and where its tip is; null when neither does or both seem to. */
export function headOf(points: ReadonlyArray<readonly [number, number]>): { end: 'start' | 'end'; at: [number, number] } | null {
  const end = tipAtEnd(points)
  const start = tipAtEnd([...points].reverse())
  if (!end === !start) return null
  const tip = (end ?? start)!
  return { end: end ? 'end' : 'start', at: [tip[0], tip[1]] }
}

const facePoint = (u: Under | undefined): Vec3 | null => (u && 'ref' in u && u.point ? u.point : null)

/**
 * What a pen stroke says as a vector. `points` is the stroke as drawn; `samples` are the points of it that were looked
 * under, and `found` what each lies over. Both ends must lie over a face: the head's end is where the stroke turns
 * back (the sample nearest to it), else the stroke's own first and last. None for a dot, or ends that meet.
 */
export function vectorOf(points: ReadonlyArray<readonly [number, number]>, samples: ReadonlyArray<readonly [number, number]>, found: readonly Under[]): StrokeVector | undefined {
  if (samples.length < 2 || found.length !== samples.length) return undefined
  const head = headOf(points)
  // `to` is the head's end, at its tip (the sample nearest where the stroke turns); `from` is the other end of the stroke.
  let tip = samples.length - 1
  let tail = 0
  if (head) {
    const near = samples.reduce((best, s, i) => (dist(s, head.at) < dist(samples[best], head.at) ? i : best), 0)
    if (head.end === 'end') tip = near
    else {
      tip = near
      tail = samples.length - 1
    }
  }
  const a = facePoint(found[tail])
  const b = facePoint(found[tip])
  if (!a || !b) return undefined
  const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const length = Math.hypot(...delta)
  if (!(length > 0.01)) return undefined
  return { from: [...a], to: [...b], length, direction: [delta[0] / length, delta[1] / length, delta[2] / length], head: head ? 'to' : 'unknown' }
}
