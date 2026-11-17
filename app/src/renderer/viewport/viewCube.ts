import type { Vec3 } from '../../shared/marks'
import type { MainAxis } from '../../shared/planes'

// The view cube of a sketch: a small cube in the top right of the view, turned as the camera is, whose faces are the three
// main planes. A click on a face makes that plane the sketch's. Drawn on the canvas of the overlay, never through React;
// the faces as last drawn are what a click is told against (`faceAt`).

/** Half the side of the cube on screen, in pixels. */
export const CUBE_HALF_PX = 26
/** The space between the cube and the top and the right of the view, in pixels. */
const FROM_RIGHT = 30
const FROM_TOP = 84

/** A camera as its axes in the object frame. */
export interface CameraAxes {
  right: Vec3
  up: Vec3
  /** The way it looks. */
  forward: Vec3
}

/** One face of the cube: the plane it stands for, which side of it, where it is on screen, and whether it faces the camera. */
export interface CubeFace {
  name: MainAxis
  /** +1 for the face on the positive side of the axis it is across, -1 for the other. */
  sign: 1 | -1
  polygon: Array<[number, number]>
  centre: [number, number]
  facing: boolean
}

/** Where the cube's middle is, for a view `width` pixels wide. */
export function cubeCentre(width: number): [number, number] {
  return [width - FROM_RIGHT - CUBE_HALF_PX, FROM_TOP + CUBE_HALF_PX]
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const PLANES: Array<{ name: MainAxis; across: 0 | 1 | 2 }> = [
  { name: 'YZ', across: 0 },
  { name: 'XZ', across: 1 },
  { name: 'XY', across: 2 }
]

/** The six faces of a cube of half-side `half` px at `at` (client or canvas pixels), as a camera with these axes sees it. */
export function cubeFaces(camera: CameraAxes, at: [number, number], half: number): CubeFace[] {
  const screen = (v: Vec3): [number, number] => [at[0] + dot(v, camera.right) * half, at[1] - dot(v, camera.up) * half]
  const faces: CubeFace[] = []
  for (const { name, across } of PLANES) {
    const u = (across + 1) % 3
    const v = (across + 2) % 3
    for (const sign of [1, -1] as const) {
      const corner = (a: number, b: number): Vec3 => {
        const p: Vec3 = [0, 0, 0]
        p[across] = sign
        p[u] = a
        p[v] = b
        return p
      }
      const normal = corner(0, 0)
      faces.push({
        name,
        sign,
        polygon: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map(screen),
        centre: screen(normal),
        // Towards the camera: against the way it looks. Edge-on is not facing.
        facing: dot(normal, camera.forward) < -1e-6
      })
    }
  }
  return faces
}

/** Whether a point is inside a polygon (even-odd). */
function inside(polygon: ReadonlyArray<[number, number]>, [x, y]: [number, number]): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** The plane whose face is at a point, among those that face the camera; null beside the cube. */
export function faceAt(faces: readonly CubeFace[], point: [number, number]): MainAxis | null {
  return faces.find((f) => f.facing && inside(f.polygon, point))?.name ?? null
}

/** Draws the cube: the faces that face the camera, each with its plane's name, the active plane's in the accent. */
export function drawViewCube(ctx: CanvasRenderingContext2D, faces: readonly CubeFace[], active: MainAxis | null, colours: { accent: string; ink: string; paper: string; hairline: string }): void {
  ctx.save()
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const face of faces) {
    if (!face.facing) continue
    ctx.beginPath()
    face.polygon.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
    ctx.globalAlpha = face.name === active ? 0.95 : 0.86
    ctx.fillStyle = face.name === active ? colours.accent : colours.paper
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = face.name === active ? colours.accent : colours.hairline
    ctx.stroke()
    // A face seen edge-on has no room for its name.
    const [a, b, c] = face.polygon
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
    if (area > 200) {
      ctx.fillStyle = face.name === active ? colours.paper : colours.ink
      ctx.fillText(face.name, face.centre[0], face.centre[1])
    }
  }
  ctx.restore()
}
