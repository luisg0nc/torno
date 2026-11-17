import { ALMOST_IN_LINE, eigenSymmetric } from './align'
import { number } from './format'

// Lining a photo up with a tracing: the pure maths both sides use. The person clicks the same spots on the photo (pixels of the
// kept file, x to the right and y DOWN) and on the tracing (`uv`, millimetres, u to the right and v UP); main fits what maps one
// to the other from those pairs and keeps it (`main/tracings/store.ts`), the window fits the same way to show the bar live. A
// photo is no measurement: nothing here is exact, and what it says is true only in the tracing's plane.

/** What a click on the tracing was snapped to: a corner of the cut by its place, a hole centre by its edge's ref or its place, a vertex by its ref. */
export type LineupSnap = { corner: [number, number] } | { centre: string | [number, number] } | { vertex: string }

/** A point of the photo (pixels of the kept file) and the point of the tracing (`uv`, mm) it is lined up with, and what the point was snapped to. */
export interface LineupPair {
  photo: [number, number]
  uv: [number, number]
  snap?: LineupSnap
}

/** A 3 × 3 matrix by rows: from pixels of the photo to `uv` in mm. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number]

export interface Lineup {
  /** 3 × 3, row-major: photo px → uv mm. */
  transform: Matrix3
  /** Pixels per mm at the tracing's centre (for a similarity, everywhere). */
  scale: number
  /** Degrees the photo was turned: the direction of its x axis in `uv`, from `u` towards `v`. */
  angle: number
  /** The root mean square of what the pairs are left apart, in mm: only when there are more pairs than the method needs. */
  fit?: number
}

/** The most pairs a line-up has, and how many each method needs. */
export const MOST_PAIRS = 8
export const SIMILAR_NEEDS = 2
export const STRAIGHT_NEEDS = 4

/** Said when a straightening folds the plane: the points are not in the same order on the photo and on the tracing. */
export const FOLDED = 'the points are not in the same order on the photo and on the tracing: the straightening would fold the plane'
export const SAME_PLACE = 'two of the points are on top of each other: pick points further apart'
/** Said when the line sent to infinity crosses the photo (not only its clicked points): the straightened picture would fold. */
export const PHOTO_FOLDS = 'the photo would fold: its corners do not all lie on one side of the line the straightening sends to infinity; pick points that spread over more of it'
/** Said when the photo would land on the tracing the wrong way round. */
export const MIRRORED = 'the photo would be laid on the tracing the wrong way round (mirrored): check the order the points were clicked in on the tracing'
/** Two photo points closer than this many pixels are one point. */
export const MIN_APART_PX = 1
export const LINEUP_CLOSING = "not exact, and true only in the tracing's plane"

/** How close to a line three points may be before they are refused: the smallest altitude of their triangle over its longest side. */
const LINE_RATIO = 0.02
/** The photo's point nearest the vanishing line, as a share of the farthest from it: under this the picture is as good as folded. */
const FOLD_RATIO = 0.01

const finite2 = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((c) => typeof c === 'number' && Number.isFinite(c))

/** The pairs that can be fitted: each with two finite points. Said in words when not. */
function readable(pairs: readonly LineupPair[], needs: number): string | null {
  if (!Array.isArray(pairs)) return 'there are no points to line up'
  if (!pairs.every((p) => typeof p === 'object' && p !== null && finite2(p.photo) && finite2(p.uv))) return 'a point is not two finite numbers'
  if (pairs.length < needs) return `${needs} points are needed, and there ${pairs.length === 1 ? 'is 1' : `are ${pairs.length}`}`
  if (pairs.length > MOST_PAIRS) return `at most ${MOST_PAIRS} points are used, and there are ${pairs.length}`
  return null
}

/** The point the transform sends `p` to. A point on the line the transform sends to infinity gives NaN. */
export function applyLineup(transform: readonly number[], p: readonly [number, number]): [number, number] {
  const [a, b, c, d, e, f, g, h, i] = transform
  const w = g * p[0] + h * p[1] + i
  if (w === 0 || !Number.isFinite(w)) return [Number.NaN, Number.NaN]
  return [(a * p[0] + b * p[1] + c) / w, (d * p[0] + e * p[1] + f) / w]
}

/** The matrix that undoes `transform` (uv mm → photo px), or null when it cannot be undone. */
export function invertLineup(transform: readonly number[]): Matrix3 | null {
  if (transform.length !== 9 || !transform.every(Number.isFinite)) return null
  const [a, b, c, d, e, f, g, h, i] = transform
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  const size = Math.max(...transform.map(Math.abs))
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12 * size * size * size) return null
  const inv: Matrix3 = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d]
  return inv.map((v) => v / det + 0) as Matrix3
}

const rms = (pairs: readonly LineupPair[], transform: readonly number[]): number =>
  Math.sqrt(pairs.reduce((sum, p) => sum + (([u, v]) => (u - p.uv[0]) ** 2 + (v - p.uv[1]) ** 2)(applyLineup(transform, p.photo)), 0) / pairs.length)

/**
 * The turn and the scale of a transform at a photo point: the Jacobian of the map there. `scale` is pixels per mm (one over the
 * square root of what a pixel's area becomes, in mm²), `angle` the direction the photo's x axis points in `uv`, in degrees.
 */
function localOf(transform: readonly number[], at: readonly [number, number]): { scale: number; angle: number; det: number } | null {
  const [a, b, , d, e, , g, h, i] = transform
  const w = g * at[0] + h * at[1] + i
  const [u, v] = applyLineup(transform, at)
  if (!Number.isFinite(u) || !Number.isFinite(w) || w === 0) return null
  const j00 = (a - u * g) / w
  const j01 = (b - u * h) / w
  const j10 = (d - v * g) / w
  const j11 = (e - v * h) / w
  const det = j00 * j11 - j01 * j10
  const area = Math.abs(det)
  if (!(area > 0) || !Number.isFinite(area)) return null
  const angle = (Math.atan2(j10, j00) * 180) / Math.PI
  return { scale: 1 / Math.sqrt(area), angle: angle === 0 ? 0 : angle, det }
}

/**
 * A similarity (a turn, one scale and a shift, and the photo's y running down while `v` runs up) by least squares from 2 pairs or
 * more. With exactly 2 it passes through both and has no `fit`; with more, `fit` is the root mean square of what they are left
 * apart, in mm. Refused in words for fewer than 2, for two photo points on top of each other and for points of the tracing that are.
 */
export function fitSimilar(pairs: readonly LineupPair[]): Lineup | { error: string } {
  const bad = readable(pairs, SIMILAR_NEEDS)
  if (bad !== null) return { error: bad }
  const n = pairs.length
  if (apartLess(pairs.map((p) => p.photo))) return { error: SAME_PLACE }
  // The photo as complex numbers with y turned up, and the tracing's points: w = a z + b.
  const z = pairs.map((p) => [p.photo[0], -p.photo[1]] as const)
  const w = pairs.map((p) => p.uv)
  const mean = (list: ReadonlyArray<readonly [number, number]>): [number, number] => [list.reduce((s, p) => s + p[0], 0) / n, list.reduce((s, p) => s + p[1], 0) / n]
  const zc = mean(z)
  const wc = mean(w)
  let zz = 0
  let ww = 0
  let re = 0
  let im = 0
  for (let k = 0; k < n; k++) {
    const zx = z[k][0] - zc[0]
    const zy = z[k][1] - zc[1]
    const wx = w[k][0] - wc[0]
    const wy = w[k][1] - wc[1]
    zz += zx * zx + zy * zy
    ww += wx * wx + wy * wy
    // conj(z) * w
    re += zx * wx + zy * wy
    im += zx * wy - zy * wx
  }
  if (!(zz > 1e-18)) return { error: SAME_PLACE }
  if (!(ww > 1e-18)) return { error: 'the points on the tracing are all in one place: pick points further apart' }
  const ar = re / zz
  const ai = im / zz
  if (!(Math.hypot(ar, ai) > 0)) return { error: 'the points do not fix a scale: pick points on the tracing that are as far apart as those on the photo' }
  // w = a (x - i y) + b: u = ar x + ai y + br, v = ai x - ar y + bi.
  const br = wc[0] - (ar * zc[0] - ai * zc[1])
  const bi = wc[1] - (ar * zc[1] + ai * zc[0])
  const transform: Matrix3 = [ar, ai, br, ai, -ar, bi, 0, 0, 1]
  const local = localOf(transform, [0, 0])
  if (!local) return { error: 'the points do not fix a scale' }
  return { transform, scale: local.scale, angle: local.angle, ...(n > SIMILAR_NEEDS ? { fit: rms(pairs, transform) } : {}) }
}

/** Whether any two of the points are closer than `MIN_APART_PX`. */
function apartLess(points: ReadonlyArray<readonly [number, number]>): boolean {
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) if (Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]) < MIN_APART_PX) return true
  return false
}

/** Whether three points are nearly in a line: their smallest altitude is under `LINE_RATIO` of their longest side. */
function nearlyInLine(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): boolean {
  const longest = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]))
  if (!(longest > 0)) return true
  const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
  return twiceArea / (longest * longest) < LINE_RATIO
}

/**
 * Whether the points leave no four that are well placed (no three of them nearly in a line, on the photo or on the tracing): with
 * exactly four that is any three nearly in a line; with more, a spare point may sit near a line of two others so long as some
 * four do not.
 */
function noWellPlacedFour(photos: ReadonlyArray<readonly [number, number]>, tracing: ReadonlyArray<readonly [number, number]>): boolean {
  const spread = (side: ReadonlyArray<readonly [number, number]>, i: number, j: number, k: number): boolean => !nearlyInLine(side[i], side[j], side[k])
  const fine = (i: number, j: number, k: number): boolean => spread(photos, i, j, k) && spread(tracing, i, j, k)
  const n = photos.length
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) if (fine(i, j, k) && fine(i, j, l) && fine(i, k, l) && fine(j, k, l)) return false
  return true
}

/** Points moved and scaled so their centroid is the origin and their mean distance from it is √2: the matrix that does it, and the points. */
function normalised(points: ReadonlyArray<readonly [number, number]>): { matrix: Matrix3; points: Array<[number, number]> } {
  const n = points.length
  const cx = points.reduce((s, p) => s + p[0], 0) / n
  const cy = points.reduce((s, p) => s + p[1], 0) / n
  const mean = points.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n
  const k = mean > 0 ? Math.SQRT2 / mean : 1
  return { matrix: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], points: points.map((p) => [k * (p[0] - cx), k * (p[1] - cy)] as [number, number]) }
}

const times = (a: Matrix3, b: Matrix3): Matrix3 => {
  const out = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[3 * r + c] += a[3 * r + k] * b[3 * k + c]
  return out as Matrix3
}

/**
 * A homography (what straightens an angled photo) by the direct linear transform, from 4 pairs or more, the points moved and
 * scaled first (Hartley's normalisation) so that it is as well posed as it can be. Refused in words when three of the photo's
 * points, or of the tracing's, are nearly in a line (`ALMOST_IN_LINE`; with spare points, when no four are free of that), when two are on top of each other, and when the fit folds
 * the plane (the photo's points do not all lie on one side of the line it sends to infinity). With exactly 4 pairs it passes
 * through them and has no `fit`. `centre` is the point of the tracing the scale and the angle are told at (the middle of its outline;
 * the middle of the pairs' own points when it is not given). `size` is the photo's width and height in px: its four corners must lie in
 * front of the vanishing line too. A map that would lay the photo mirrored is refused.
 */
export function fitStraight(pairs: readonly LineupPair[], opts: { centre?: readonly [number, number]; size?: readonly [number, number] } = {}): Lineup | { error: string } {
  const bad = readable(pairs, STRAIGHT_NEEDS)
  if (bad !== null) return { error: bad }
  const photos = pairs.map((p) => p.photo)
  const tracing = pairs.map((p) => p.uv)
  if (apartLess(photos)) return { error: SAME_PLACE }
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      if (Math.hypot(tracing[i][0] - tracing[j][0], tracing[i][1] - tracing[j][1]) < 1e-9) return { error: 'two of the points on the tracing are on top of each other: pick points further apart' }
    }
  }
  if (noWellPlacedFour(photos, tracing)) return { error: ALMOST_IN_LINE }
  const from = normalised(photos)
  const to = normalised(tracing)
  // Each pair gives two rows of A h = 0; h is the eigenvector of AᵀA of the least eigenvalue.
  const ata = Array.from({ length: 9 }, () => new Array<number>(9).fill(0))
  const rows: number[][] = []
  for (let k = 0; k < pairs.length; k++) {
    const [x, y] = from.points[k]
    const [u, v] = to.points[k]
    rows.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u], [0, 0, 0, -x, -y, -1, v * x, v * y, v])
  }
  for (const row of rows) for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) ata[r][c] += row[r] * row[c]
  const { values, vectors } = eigenSymmetric(ata)
  const least = values.reduce((best, value, i) => (value < values[best] ? i : best), 0)
  const h = vectors.map((row) => row[least])
  const inverse = invertLineup(to.matrix)
  if (!inverse) return { error: 'the points do not fix a straightening' }
  let transform = times(times(inverse, h as Matrix3), from.matrix)
  // One of the many multiples of it: the one that sends the middle of the photo's points to a positive denominator of one.
  const middle: [number, number] = [photos.reduce((s, p) => s + p[0], 0) / photos.length, photos.reduce((s, p) => s + p[1], 0) / photos.length]
  const denominatorAt = (m: readonly number[], p: readonly [number, number]): number => m[6] * p[0] + m[7] * p[1] + m[8]
  const w0 = denominatorAt(transform, middle)
  if (!(Math.abs(w0) > 0) || !Number.isFinite(w0)) return { error: FOLDED }
  transform = transform.map((c) => c / w0 + 0) as Matrix3
  // The line sent to infinity must not cross the photo's points: all of them on one side of it, and none close to it.
  const denominators = photos.map((p) => denominatorAt(transform, p))
  const nearest = Math.min(...denominators)
  const farthest = Math.max(...denominators)
  if (!(nearest > FOLD_RATIO * farthest) || !denominators.every(Number.isFinite)) return { error: FOLDED }
  // And its corners, when the photo's size is known: the line sent to infinity must not cross the picture that is straightened.
  if (opts.size !== undefined) {
    const [w, h] = opts.size
    if (![[0, 0], [w, 0], [w, h], [0, h]].every((corner) => denominatorAt(transform, corner as [number, number]) > 0)) return { error: PHOTO_FOLDS }
  }
  const here = opts.centre ?? ([tracing.reduce((s, p) => s + p[0], 0) / tracing.length, tracing.reduce((s, p) => s + p[1], 0) / tracing.length] as [number, number])
  const back = invertLineup(transform)
  const photoAt = back ? applyLineup(back, here) : ([Number.NaN, Number.NaN] as [number, number])
  const local = Number.isFinite(photoAt[0]) ? localOf(transform, photoAt) : null
  if (!local) return { error: FOLDED }
  // An upright photo has its y down and `v` up, so its map turns the plane over: a map that does not is a mirrored photo.
  if (local.det > 0) return { error: MIRRORED }
  return { transform, scale: local.scale, angle: local.angle, ...(pairs.length > STRAIGHT_NEEDS ? { fit: rms(pairs, transform) } : {}) }
}

/** A box in the tracing's `[u, v]`, mm. */
export interface UvRect {
  min: [number, number]
  max: [number, number]
}

/**
 * The box in mm that the four corners of a `width` by `height` photo land in under `transform`: where its straightened copy is
 * placed, one rule for the window (which makes the copy) and for main (the export). Null when a corner goes to infinity.
 */
export function photoRect(transform: readonly number[], width: number, height: number): UvRect | null {
  const corners = [applyLineup(transform, [0, 0]), applyLineup(transform, [width, 0]), applyLineup(transform, [width, height]), applyLineup(transform, [0, height])]
  if (!corners.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null
  const us = corners.map((p) => p[0])
  const vs = corners.map((p) => p[1])
  return { min: [Math.min(...us), Math.min(...vs)], max: [Math.max(...us), Math.max(...vs)] }
}

/** The matrix as text, to the digit: what a straightened copy is made of, so that one made of another line-up is known. */
export const transformKey = (transform: readonly number[]): string => transform.map(String).join(',')

/** What a line-up is, in words: how many points, how it was made, its scale, turn and fit, and what it is worth. Never exact. */
export function lineupSaid(photo: { pairs: readonly unknown[]; method: 'similar' | 'straight'; scale?: number; angle?: number; fit?: number }): string {
  if (photo.scale === undefined || photo.pairs.length === 0) return 'not lined up'
  const points = `${photo.pairs.length} ${photo.pairs.length === 1 ? 'point' : 'points'}`
  const method = photo.method === 'straight' ? `lined up by ${points}, straightened:` : `lined up by ${points}:`
  const turned = photo.angle === undefined ? '' : `, turned ${number(photo.angle)}°`
  const fit = photo.fit === undefined ? ', no spare point to check it' : `, fit ${number(photo.fit)} mm`
  return `${method} ${number(photo.scale)} px/mm at the centre${turned}${fit}; ${LINEUP_CLOSING}`
}
