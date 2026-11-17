import type { Vec3 } from './marks'

// The frames of the planes a sketch is drawn on, which main makes for the planes Claude names (`add_sketch`) and the
// window makes for its own. One rule for both, so that a main plane is the same plane whoever made it: its labels follow
// those of `viewPlane` (`renderer/tools/planes.ts`), `XZ at y = 40.0 (u = +X, v = +Z)`.

export type MainAxis = 'XY' | 'XZ' | 'YZ'

/** A plane's frame: a point of it, its two unit axes (the normal is `x × y`) and its label. */
export interface PlaneFrame {
  origin: Vec3
  x: Vec3
  y: Vec3
  label: string
}

const LETTERS = ['X', 'Y', 'Z'] as const

const MAIN: Record<MainAxis, { fixed: 0 | 1 | 2; u: 0 | 1 | 2; v: 0 | 1 | 2 }> = {
  XY: { fixed: 2, u: 0, v: 1 },
  XZ: { fixed: 1, u: 0, v: 2 },
  YZ: { fixed: 0, u: 1, v: 2 }
}

const unitAlong = (axis: number): Vec3 => [0, 1, 2].map((i) => (i === axis ? 1 : 0)) as Vec3

/** Which way a unit vector points, in a label: `+X` or `-Z` along a principal axis, else its three numbers to the hundredth. */
export function directionText(v: Vec3): string {
  const axis = v.findIndex((c) => Math.abs(c) === 1)
  if (axis >= 0 && v.every((c, i) => i === axis || c === 0)) return `${v[axis] > 0 ? '+' : '-'}${LETTERS[axis]}`
  return `[${v.map((c) => Math.round(c * 100) / 100 + 0).join(', ')}]`
}

/** A number in a label: one decimal, and never `-0.0`. */
const coordinate = (n: number): string => {
  const text = n.toFixed(1)
  return text === '-0.0' ? '0.0' : text
}

/**
 * A main plane at `offset` mm along the axis it is across: `XY` is across Z, `XZ` across Y and `YZ` across X. Its `x` and
 * `y` run along the positive axes it spans, as the plane seen from the front, the top and the right has them.
 */
export function mainPlaneFrame(axis: MainAxis, offset: number): PlaneFrame {
  const { fixed, u, v } = MAIN[axis]
  const x = unitAlong(u)
  const y = unitAlong(v)
  const origin = unitAlong(fixed).map((c) => c * offset + 0) as Vec3
  return { origin, x, y, label: `${axis} at ${LETTERS[fixed].toLowerCase()} = ${coordinate(offset)} (u = ${directionText(x)}, v = ${directionText(y)})` }
}

/**
 * The frame of a plane that has only a normal: its `x` is the projection of +X on the plane, or of +Y where the normal runs
 * along X, and its `y` is `normal × x`, so that `x × y` is the normal. Null for a normal that is not finite or has no length.
 * The label is the caller's.
 */
export function axesOfNormal(normal: Vec3): { x: Vec3; y: Vec3; normal: Vec3 } | null {
  const length = Math.hypot(...normal)
  if (!normal.every(Number.isFinite) || !(length > 1e-9)) return null
  const n = normal.map((c) => c / length + 0) as Vec3
  const project = (a: Vec3): Vec3 => {
    const along = a[0] * n[0] + a[1] * n[1] + a[2] * n[2]
    return [a[0] - along * n[0], a[1] - along * n[1], a[2] - along * n[2]]
  }
  let x = project([1, 0, 0])
  if (Math.hypot(...x) < 1e-3) x = project([0, 1, 0])
  const lx = Math.hypot(...x)
  const unit = x.map((c) => c / lx + 0) as Vec3
  const y: Vec3 = [n[1] * unit[2] - n[2] * unit[1], n[2] * unit[0] - n[0] * unit[2], n[0] * unit[1] - n[1] * unit[0]]
  return { x: unit, y: y.map((c) => c + 0) as Vec3, normal: n }
}
