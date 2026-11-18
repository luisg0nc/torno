import * as THREE from 'three'
import { MONO_STACK } from '../../shared/fonts'
import type { Vec3 } from '../../shared/marks'

const MONO = MONO_STACK
const seen = new THREE.Vector3()

/**
 * Draws the value of the last measurement at `at` (the middle of its line, in the object frame), in `--ink` on a
 * plate of the panel's colour, set in the monospace face. On the canvas of the marks' labels, so in front of
 * everything and in no picture for the agent. Nothing where `at` is behind the camera.
 */
export function drawHeldValue(ctx: CanvasRenderingContext2D, held: { at: Vec3; text: string } | null, camera: THREE.Camera, size: { width: number; height: number }, colours: { ink: string; paper: string }): void {
  if (!held) return
  seen.fromArray(held.at).project(camera)
  if (!(seen.z >= -1 && seen.z <= 1)) return
  const [x, y] = [((seen.x + 1) / 2) * size.width, ((1 - seen.y) / 2) * size.height]
  ctx.save()
  ctx.font = `500 11px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const w = ctx.measureText(held.text).width + 10
  ctx.fillStyle = colours.paper
  ctx.strokeStyle = colours.ink
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - 9 - 12, w, 18, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = colours.ink
  ctx.fillText(held.text, x, y - 12)
  ctx.restore()
}
