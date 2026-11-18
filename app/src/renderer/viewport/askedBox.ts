import * as THREE from 'three'
import { MONO_STACK } from '../../shared/fonts'
import type { Vec3 } from '../../shared/marks'

/** A box in the object frame, and the words of its size. */
export interface AskedBox {
  min: Vec3
  max: Vec3
  label: string
}

/** The twelve edges of a box, as pairs of its corners (bit 0 is x, bit 1 is y, bit 2 is z: high). */
export const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
]

const seen = new THREE.Vector3()

/**
 * Draws the box a scan would have if it were read in another unit (the scan read question, spec 2026-11-18 section 2): its
 * twelve edges dashed in the accent, and its size at its far corner, in the monospace face. On the canvas of the marks'
 * labels, so in front of everything and in no picture for the agent. An edge with an end behind the camera is left out.
 */
export function drawAskedBox(ctx: CanvasRenderingContext2D, box: AskedBox | null, camera: THREE.Camera, size: { width: number; height: number }, colours: { accent: string; paper: string }): void {
  if (!box) return
  const corners = Array.from({ length: 8 }, (_, n): [number, number] | null => {
    seen.set(n & 1 ? box.max[0] : box.min[0], n & 2 ? box.max[1] : box.min[1], n & 4 ? box.max[2] : box.min[2]).project(camera)
    return seen.z >= -1 && seen.z <= 1 ? [((seen.x + 1) / 2) * size.width, ((1 - seen.y) / 2) * size.height] : null
  })
  ctx.save()
  ctx.strokeStyle = colours.accent
  ctx.lineWidth = 1.25
  ctx.setLineDash([5, 4])
  for (const [a, b] of EDGES) {
    const from = corners[a]
    const to = corners[b]
    if (!from || !to) continue
    ctx.beginPath()
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(to[0], to[1])
    ctx.stroke()
  }
  ctx.setLineDash([])
  // Its size beside the corner farthest from the lowest one, on a plate of the panel's colour.
  const far = corners[7]
  if (far) {
    ctx.font = `500 11px ${MONO_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(box.label).width + 10
    ctx.fillStyle = colours.paper
    ctx.beginPath()
    ctx.roundRect(far[0] - w / 2, far[1] - 9 - 8, w, 18, 3)
    ctx.fill()
    ctx.strokeStyle = colours.accent
    ctx.stroke()
    ctx.fillStyle = colours.accent
    ctx.fillText(box.label, far[0], far[1] - 8)
  }
  ctx.restore()
}
