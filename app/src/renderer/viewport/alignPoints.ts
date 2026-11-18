import * as THREE from 'three'
import { MONO_STACK } from '../../shared/fonts'
import type { Vec3 } from '../../shared/marks'

/** A point of an alignment being made: where it is, in the object frame, and its number. A model end is drawn hollow, a scan end filled. */
export interface AlignPoint { at: Vec3; label: string; hollow?: boolean }

const RADIUS = 8
const MONO = MONO_STACK
const seen = new THREE.Vector3()

/**
 * Draws the ends of the pairs being made, and the points a floor is laid through, as numbered dots over the
 * view: on the canvas of the marks' labels, so in front of everything and in no picture for the agent. In the
 * accent colour, never a mark's. `camera`'s matrices are up to date; `size` is the view in pixels.
 */
export function drawAlignPoints(ctx: CanvasRenderingContext2D, points: readonly AlignPoint[], camera: THREE.Camera, size: { width: number; height: number }, colours: { accent: string; paper: string }): void {
  if (points.length === 0) return
  ctx.save()
  ctx.font = `500 10.5px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const point of points) {
    seen.fromArray(point.at).project(camera)
    // Behind the camera, or past what it draws: there is nowhere it is seen.
    if (!(seen.z >= -1 && seen.z <= 1)) continue
    const [x, y] = [((seen.x + 1) / 2) * size.width, ((1 - seen.y) / 2) * size.height]
    const [body, ink] = point.hollow ? [colours.paper, colours.accent] : [colours.accent, colours.paper]
    const radius = point.label === '' ? RADIUS / 2 : RADIUS
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, 2 * Math.PI)
    ctx.fillStyle = body
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = point.hollow ? colours.accent : colours.paper
    ctx.stroke()
    if (point.label !== '') {
      ctx.fillStyle = ink
      ctx.fillText(point.label, x, y)
    }
  }
  ctx.restore()
}
