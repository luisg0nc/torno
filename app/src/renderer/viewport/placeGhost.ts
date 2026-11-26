import * as THREE from 'three'
import type { Vec3 } from '../../shared/marks'
import type { Outline } from '../../shared/shelf'

/**
 * A shelf part laid on a face while it is being placed (#353): the cutout's plan outline and the keep-out's, as the kernel drew them in
 * the part's XY (the panel's plane, the part's +Z the side the person sees). Both are in millimetres and are laid in the face's
 * plane about a point, the part's +Z along the face's outward normal.
 */
export interface PlaceShape {
  at: Vec3
  normal: Vec3
  cutout: Outline[]
  keepout?: Outline[]
}

/** The part's axes in the object frame. */
export interface Frame {
  x: Vec3
  y: Vec3
  z: Vec3
}

/** How far past the farthest point of the cutout a placed one's ring stands, in millimetres. */
const HALO_MM = 1.6

const seen = new THREE.Vector3()
const along = new THREE.Vector3()
const across = new THREE.Vector3()

/**
 * The part's frame on a face: Z is the outward normal, X is the world X taken into the face's plane (the world Y when the face looks
 * along X, so that X is never lost), Y is Z across X. A stable choice: the same face always gives the same turn of the part, so the
 * ghost does not spin as the pointer moves over it. A normal of no length is the world Z.
 */
export function faceFrame(normal: Vec3): Frame {
  const z = new THREE.Vector3().fromArray(normal)
  if (z.lengthSq() < 1e-12) z.set(0, 0, 1)
  z.normalize()
  const reference = Math.abs(z.x) > 0.9 ? along.set(0, 1, 0) : along.set(1, 0, 0)
  const x = across.copy(reference).addScaledVector(z, -reference.dot(z)).normalize().clone()
  const y = new THREE.Vector3().crossVectors(z, x)
  return { x: x.toArray() as Vec3, y: y.toArray() as Vec3, z: z.toArray() as Vec3 }
}

/** An outline of the part's plan as points of the object frame, in the face's plane about `at`. */
export function onFace(points: ReadonlyArray<readonly [number, number]>, frame: Frame, at: Vec3): Vec3[] {
  return points.map(([px, py]) => [at[0] + frame.x[0] * px + frame.y[0] * py, at[1] + frame.x[1] * px + frame.y[1] * py, at[2] + frame.x[2] * px + frame.y[2] * py] as Vec3)
}

/** The farthest any point of the outlines is from the part's origin, in millimetres: the radius a ring round the cutout needs. */
export function haloReach(outlines: readonly Outline[]): number {
  let far = 0
  for (const { points } of outlines) for (const [x, y] of points) far = Math.max(far, Math.hypot(x, y))
  return far
}

/** An outline projected to the canvas, in pixels; null when a point is behind the camera or past what it draws. */
function screen(points: Vec3[], camera: THREE.Camera, size: { width: number; height: number }): Array<[number, number]> | null {
  const out: Array<[number, number]> = []
  for (const p of points) {
    seen.fromArray(p).project(camera)
    if (!(seen.z >= -1 && seen.z <= 1)) return null
    out.push([((seen.x + 1) / 2) * size.width, ((1 - seen.y) / 2) * size.height])
  }
  return out
}

function trace(ctx: CanvasRenderingContext2D, shape: Array<[number, number]>): void {
  ctx.beginPath()
  shape.forEach(([x, y], n) => (n === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
}

/** A circle of radius `r` mm about `at` in the plane of `frame`, as points of the object frame. */
function ringPoints(at: Vec3, frame: Frame, r: number, segments = 40): Vec3[] {
  return Array.from({ length: segments }, (_, n) => {
    const turn = (2 * Math.PI * n) / segments
    return onFace([[r * Math.cos(turn), r * Math.sin(turn)]], frame, at)[0]
  })
}

/**
 * Draws the part being placed and the ones placed in this go, over everything on the canvas of the marks' labels and in no picture for
 * the agent: the ghost has the cutout as a solid accent line and the keep-out dashed, in the accent, over a light accent fill; each one
 * placed keeps its cutout in the accent with a thin ring round it. `camera`'s matrices are up to date.
 */
export function drawPlaceGhost(ctx: CanvasRenderingContext2D, ghost: PlaceShape | null, placed: readonly PlaceShape[], camera: THREE.Camera, size: { width: number; height: number }, colours: { accent: string; paper: string }): void {
  if (!ghost && placed.length === 0) return
  ctx.save()
  ctx.lineJoin = 'round'
  const stroke = (shape: Array<[number, number]>, width: number, dash: number[]): void => {
    trace(ctx, shape)
    ctx.lineWidth = width + 1.75
    ctx.strokeStyle = colours.paper
    ctx.globalAlpha = 0.7
    ctx.setLineDash([])
    ctx.stroke()
    trace(ctx, shape)
    ctx.lineWidth = width
    ctx.strokeStyle = colours.accent
    ctx.globalAlpha = 1
    ctx.setLineDash(dash)
    ctx.stroke()
  }
  for (const one of placed) {
    const frame = faceFrame(one.normal)
    for (const outline of one.cutout) {
      const shape = screen(onFace(outline.points, frame, one.at), camera, size)
      if (shape) stroke(shape, 1.5, [])
    }
    const ring = screen(ringPoints(one.at, frame, haloReach(one.cutout) + HALO_MM), camera, size)
    if (ring) stroke(ring, 1, [])
  }
  if (ghost) {
    const frame = faceFrame(ghost.normal)
    for (const outline of ghost.keepout ?? []) {
      if (outline.hole) continue
      const shape = screen(onFace(outline.points, frame, ghost.at), camera, size)
      if (!shape) continue
      trace(ctx, shape)
      ctx.globalAlpha = 0.12
      ctx.fillStyle = colours.accent
      ctx.fill()
      stroke(shape, 1.25, [5, 4])
    }
    for (const outline of ghost.cutout) {
      const shape = screen(onFace(outline.points, frame, ghost.at), camera, size)
      if (shape) stroke(shape, 1.75, [])
    }
  }
  ctx.restore()
}
