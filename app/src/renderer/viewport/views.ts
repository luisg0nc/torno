import { type FocusBox, focusFrame } from '../../shared/focus'
import { BENCH_MM_PER_PX, THUMB_HEIGHT, THUMB_WIDTH } from '../../shared/thumbnail'
import type { Camera, ViewName } from '../../shared/view'

type Vec3 = [number, number, number]

/** Vertical field of view of the perspective camera, in degrees. */
export const DEFAULT_FOV = 35

/** How much wider than the part a fitted view is. */
const FIT_MARGIN = 1.1

const ISO_FROM = normalize([1, -1, 0.8])
const ISO_DIR: Vec3 = [-ISO_FROM[0], -ISO_FROM[1], -ISO_FROM[2]]

const VIEWS: Record<ViewName, { dir: Vec3; up: Vec3 }> = {
  front: { dir: [0, 1, 0], up: [0, 0, 1] },
  back: { dir: [0, -1, 0], up: [0, 0, 1] },
  right: { dir: [-1, 0, 0], up: [0, 0, 1] },
  left: { dir: [1, 0, 0], up: [0, 0, 1] },
  top: { dir: [0, 0, -1], up: [0, 1, 0] },
  bottom: { dir: [0, 0, 1], up: [0, -1, 0] },
  iso: { dir: ISO_DIR, up: perpendicularUp(ISO_DIR, [0, 0, 1]) }
}

/**
 * A standard view, Z up. `dir` is the way the camera looks (from the camera
 * towards the part), `up` is what points up on screen. Both are unit vectors and
 * perpendicular. `front` looks along +Y, `right` along −X, `top` along −Z with
 * +Y up; `iso` looks from (+1, −1, +0.8).
 */
export function viewDirection(v: ViewName): { dir: Vec3; up: Vec3 } {
  const { dir, up } = VIEWS[v]
  return { dir: [...dir], up: [...up] }
}

/** A camera this near a standard view, in degrees, is on it: less than one pixel of orbiting. */
const LOCK_WITHIN_DEG = 0.05
const LOCKABLE: ViewName[] = ['front', 'back', 'left', 'right', 'top', 'bottom']

/**
 * The standard view a camera is locked on: it is orthographic and looks
 * exactly as `front`, `back`, `left`, `right`, `top` or `bottom` does, the
 * same way up. Null for any other camera: one in perspective, one that was
 * turned. Where it looks from and how far it is zoomed do not matter, so
 * panning and zooming keep the lock. A drawing made on a locked view lies on
 * a principal plane, in millimetres.
 */
export function lockedViewOf(camera: Camera): ViewName | null {
  if (!camera.ortho) return null
  const looks = [camera.target[0] - camera.position[0], camera.target[1] - camera.position[1], camera.target[2] - camera.position[2]]
  const reach = Math.hypot(looks[0], looks[1], looks[2])
  const tall = Math.hypot(camera.up[0], camera.up[1], camera.up[2])
  if (!(reach > 0) || !(tall > 0)) return null
  const near = Math.cos(radians(LOCK_WITHIN_DEG))
  const cosine = (a: number[], length: number, b: Vec3): number => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / length
  return LOCKABLE.find((name) => cosine(looks, reach, VIEWS[name].dir) >= near && cosine(camera.up, tall, VIEWS[name].up) >= near) ?? null
}

/**
 * The height, in mm, that a camera shows at its target. An orthographic camera
 * shows what a perspective one at the same place would show at the target,
 * magnified by `zoom`, so switching projection keeps the part the same size.
 */
export function visibleHeight(camera: Camera): number {
  const d = distance(camera.position, camera.target)
  return (2 * d * Math.tan(radians(camera.fov) / 2)) / camera.zoom
}

/**
 * Half the width (`across`) and half the height (`upward`) that a box of this size (mm) has on screen when it is
 * seen along `dir` with `up` upward, orthographically: centred on the screen's middle, in mm.
 */
export function screenHalfExtent(size: { x: number; y: number; z: number }, dir: number[], up: number[]): { across: number; upward: number } {
  const d = normalize(dir)
  const u = perpendicularUp(d, up)
  const r = cross(d, u)
  const half = [size.x / 2, size.y / 2, size.z / 2]
  return {
    across: Math.abs(r[0]) * half[0] + Math.abs(r[1]) * half[1] + Math.abs(r[2]) * half[2],
    upward: Math.abs(u[0]) * half[0] + Math.abs(u[1]) * half[1] + Math.abs(u[2]) * half[2]
  }
}

/** The pixels left free on each side of a picture made for the bench, for the edge lines of what is at its limit. */
const BENCH_MARGIN_PX = 2

/** Whether a layout of this size (mm) stays within a picture made for the bench: iso, `BENCH_MM_PER_PX`, centred on it. */
export function benchFits(size: { x: number; y: number; z: number }): boolean {
  const { dir, up } = viewDirection('iso')
  const { across, upward } = screenHalfExtent(size, dir, up)
  return across <= (THUMB_WIDTH / 2 - BENCH_MARGIN_PX) * BENCH_MM_PER_PX && upward <= (THUMB_HEIGHT / 2 - BENCH_MARGIN_PX) * BENCH_MM_PER_PX
}

/**
 * A camera that looks along `dir` and frames `bbox` with a small margin.
 * `aspect` is width over height; `fovDeg` is the vertical field of view.
 */
export function fitCamera(
  bbox: { min: number[]; max: number[] },
  dir: number[],
  up: number[],
  aspect: number,
  fovDeg: number,
  ortho: boolean
): Camera {
  const d = normalize(dir)
  const u = perpendicularUp(d, up)
  const r = cross(d, u)
  const { min, max } = bbox
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const half = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2]
  // Never fit to nothing: an empty box is framed as if it were 1 mm across.
  const radius = Math.max(Math.hypot(half[0], half[1], half[2]), 0.5)
  const tan = Math.tan(radians(fovDeg) / 2)

  let dist: number
  let zoom = 1
  if (ortho) {
    // Half extents of the box as seen on screen.
    const across = Math.abs(r[0]) * half[0] + Math.abs(r[1]) * half[1] + Math.abs(r[2]) * half[2]
    const upward = Math.abs(u[0]) * half[0] + Math.abs(u[1]) * half[1] + Math.abs(u[2]) * half[2]
    const halfHeight = (Math.max(upward, across / aspect) || radius) * FIT_MARGIN
    // Stay well outside the part even when it is small on screen and deep (a rod
    // seen end-on); zoom makes up the difference.
    dist = Math.max(halfHeight / tan, 2 * radius)
    zoom = (dist * tan) / halfHeight
  } else {
    // Fit the bounding sphere into the narrower of the two fields of view.
    const halfAngle = Math.min(Math.atan(tan), Math.atan(tan * aspect))
    dist = (radius * FIT_MARGIN) / Math.sin(halfAngle)
  }

  return {
    position: [target[0] - d[0] * dist, target[1] - d[1] * dist, target[2] - d[2] * dist],
    target,
    up: u,
    ortho,
    fov: fovDeg,
    zoom
  }
}

/**
 * The camera of a picture, or of the screen, framed on a focus (the box and its margin, `focusFrame`): looking the
 * way `view` does, which is a standard view (orthographic, as a picture of one is), the camera on screen (`current`,
 * with its projection and its field of view) or a camera of the agent's (the same). Only the way it looks and its
 * projection are taken of a camera: where it stands and how far it is zoomed are the fit's to say.
 */
export function focusCamera(focus: FocusBox, view: ViewName | Camera | 'current', current: Camera, aspect: number): Camera {
  const frame = focusFrame(focus)
  if (typeof view === 'string' && view !== 'current') {
    const { dir, up } = viewDirection(view)
    return fitCamera(frame, dir, up, aspect, DEFAULT_FOV, true)
  }
  const from = view === 'current' ? current : view
  const dir = [from.target[0] - from.position[0], from.target[1] - from.position[1], from.target[2] - from.position[2]]
  return fitCamera(frame, dir, from.up, aspect, from.fov, from.ortho)
}

/**
 * Spacing of the ground grid for a scene `size` mm across: a power of ten or
 * five times one, giving between 6 and 30 cells across the scene.
 */
export function gridStep(size: number): number {
  if (!(size > 0) || !Number.isFinite(size)) return 1
  const n = Math.floor(Math.log10(size / 6))
  for (const step of [5 * 10 ** n, 10 ** n, 5 * 10 ** (n - 1)]) {
    if (size / step >= 6) return step
  }
  return 10 ** (n - 1)
}

/** The longest round length (1, 2 or 5 × a power of ten, in mm) no longer than `maxPx` pixels. */
export function scaleBarLength(mmPerPx: number, maxPx: number): number {
  const limit = mmPerPx * maxPx * (1 + 1e-9)
  const n = Math.floor(Math.log10(limit))
  for (const length of [10 ** (n + 1), 5 * 10 ** n, 2 * 10 ** n, 10 ** n]) {
    if (length <= limit) return length
  }
  return 5 * 10 ** (n - 1)
}

function radians(deg: number): number {
  return (deg * Math.PI) / 180
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function normalize(v: number[]): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n]
}

function cross(a: number[], b: number[]): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** The unit vector closest to `up` that is perpendicular to the unit vector `dir`. */
function perpendicularUp(dir: Vec3, up: number[]): Vec3 {
  const k = dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2]
  const v = [up[0] - k * dir[0], up[1] - k * dir[1], up[2] - k * dir[2]]
  if (Math.hypot(v[0], v[1], v[2]) > 1e-9) return normalize(v)
  // `up` runs along the view: any perpendicular will do, prefer +Y then +Z.
  return perpendicularUp(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1])
}
