import type { SketchPlane, Vec3 } from '../../../shared/marks'
import { type MainAxis, axesOfNormal, directionText, faceLabel, mainPlaneFrame } from '../../../shared/planes'
import { along, dot, sub } from '../Tool'

// The planes a sketch is drawn on, as the window makes them: a main plane, the plane of a face, a plane through a picked
// point, each at an offset along its normal. Their frames and labels are the ones main makes for the planes Claude names
// (`shared/planes.ts`), so that a plane is the same plane whoever made it. The window numbers a plane when it adds it to
// the sketch (`id`), so what is made here has none.

export { rayOnPlane, viewPlane } from '../planes'

/** A plane before the sketch has numbered it. */
export type PlaneDraft = Omit<SketchPlane, 'id'>

const AXIS: Record<MainAxis, 0 | 1 | 2> = { XY: 2, XZ: 1, YZ: 0 }

/** Numbers as a plane keeps them: no negative zeros, no noise past the nanometre. */
const tidy = (v: Vec3): Vec3 => v.map((c) => Math.round(c * 1e9) / 1e9 + 0) as Vec3
const normalOf = (plane: Pick<SketchPlane, 'x' | 'y'>): Vec3 => {
  const { x, y } = plane
  return [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
}
const hundredth = (n: number): string => String(Number(n.toFixed(2)))

/**
 * A main plane at `offset` mm along the axis it is across, through `around` (its other two coordinates, so that the plane's
 * sheet is where the person is looking): `XZ at y = 40.0 (u = +X, v = +Z)`.
 */
export function mainPlane(axis: MainAxis, offset: number, around: Vec3): PlaneDraft {
  const frame = mainPlaneFrame(axis, offset)
  const origin: Vec3 = [...around]
  origin[AXIS[axis]] = offset
  return { origin: tidy(origin), x: frame.x, y: frame.y, label: frame.label, from: { kind: 'main', axis, offset } }
}

/** The plane of a planar face, `offset` mm along its normal from its `centre`, of build `revision`; null for a normal that has no length. */
export function facePlane(ref: string, centre: Vec3, normal: Vec3, offset: number, revision: number): PlaneDraft | null {
  const axes = axesOfNormal(normal)
  if (!axes) return null
  const x = tidy(axes.x)
  const y = tidy(axes.y)
  return { origin: tidy(along(centre, axes.normal, offset)), x, y, label: faceLabel(ref, offset, x, y), from: { kind: 'face', ref, offset, revision } }
}

function pointLabel(origin: Vec3, normal: Vec3, x: Vec3, y: Vec3): string {
  return `plane through (${origin.map(hundredth).join(', ')}) normal ${directionText(normal)} (u = ${directionText(x)}, v = ${directionText(y)})`
}

/** The plane at a right angle to `normal` through `point`, `offset` mm along the normal; null for a normal that has no length. */
export function pointPlane(point: Vec3, normal: Vec3, offset: number): PlaneDraft | null {
  const axes = axesOfNormal(normal)
  if (!axes) return null
  const x = tidy(axes.x)
  const y = tidy(axes.y)
  const n = tidy(axes.normal)
  const origin = tidy(along(point, axes.normal, offset))
  return { origin, x, y, label: pointLabel(origin, n, x, y), from: { kind: 'point', point: [...point], normal: n, offset } }
}

/** The plane moved along its normal to `offset`: what a drag of its handle or a typed value does. A plane of a locked view has none and is as it was. */
export function withOffset<P extends PlaneDraft>(plane: P, offset: number): P {
  const { from } = plane
  if (from.kind === 'view') return plane
  const moved = tidy(along(plane.origin, normalOf(plane), offset - from.offset))
  switch (from.kind) {
    case 'main': {
      // A main plane's offset is the coordinate on its axis, whichever way its normal (x × y) runs.
      const origin: Vec3 = [...plane.origin]
      origin[AXIS[from.axis]] = offset
      return { ...plane, origin: tidy(origin), label: mainPlaneFrame(from.axis, offset).label, from: { ...from, offset } }
    }
    case 'face':
      return { ...plane, origin: moved, label: faceLabel(from.ref, offset, plane.x, plane.y), from: { ...from, offset } }
    case 'point':
      return { ...plane, origin: moved, label: pointLabel(moved, from.normal, plane.x, plane.y), from: { ...from, offset } }
  }
}

/**
 * The unit vector the plane's offset counts along: the positive axis it is across for a main plane (its offset is that
 * coordinate, whichever way its normal x × y runs), the normal of any other. A plane of a locked view has no offset: its normal.
 */
export function offsetDirection(plane: PlaneDraft): Vec3 {
  if (plane.from.kind === 'main') return [0, 1, 2].map((i) => (i === AXIS[plane.from.kind === 'main' ? plane.from.axis : 'XY'] ? 1 : 0)) as Vec3
  return tidy(normalOf(plane))
}

type Frame = Pick<SketchPlane, 'origin' | 'x' | 'y'>

/** A point of the object frame in a plane's own two axes, in mm from its origin. What is off the plane is dropped. */
export function toPlane(plane: Frame, point: Vec3): [number, number] {
  const from = sub(point, plane.origin)
  return [dot(from, plane.x), dot(from, plane.y)]
}

/** A point of a plane given in its own axes, in the object frame. */
export function fromPlane(plane: Frame, [u, v]: [number, number]): Vec3 {
  return along(along(plane.origin, plane.x, u), plane.y, v)
}

export { normalOf as planeNormal }
