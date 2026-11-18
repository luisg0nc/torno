import type { SectionPlane } from '../../shared/view'
import { planeRect, sectionExtent, sectionOffset, type Box } from './section'

type Vec3 = [number, number, number]

/** The gap between two ticks of the rule, and between two labels, in millimetres. */
export const TICK_MM = 5
export const LABEL_MM = 20

/**
 * The ticks of the section's rule on the ground, from the plane's least offset to its greatest: one every 5 mm (on
 * the multiples of 5, so that 0 is always one when it is in reach), and a label every 20 mm. The offsets are the
 * plane's, from the middle of the parts along its normal.
 */
export function ruleTicks(min: number, max: number): Array<{ at: number; label?: string }> {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return []
  const ticks: Array<{ at: number; label?: string }> = []
  const first = Math.ceil(min / TICK_MM - 1e-9)
  const last = Math.floor(max / TICK_MM + 1e-9)
  for (let n = first; n <= last; n++) {
    const at = n * TICK_MM + 0
    ticks.push(at % LABEL_MM === 0 ? { at, label: String(at) } : { at })
  }
  return ticks
}

/** Where on the rule (0 at its least offset, 1 at its greatest) a plane at `offset` has its handle. Kept on the rule; the middle of one with no length. */
export function handleAt(offset: number, min: number, max: number): number {
  if (!(max > min)) return 0.5
  return Math.min(Math.max((offset - min) / (max - min), 0), 1)
}

const centre = (box: Box): Vec3 => [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2) as Vec3

/**
 * The point of the rule at `offset`: a line along the normal, standing beside the parts where the camera sees it
 * whatever the plane is. Across a horizontal axis it lies on the ground (the least z of the parts), at the +x, +y side of
 * them, to the right of the view from the corner; across Z it stands upright at the +x, -y corner, the one nearest the viewer on the right. It is moved from the
 * middle of the parts only square to the normal, so that a point of it at an offset is on the plane that has that offset.
 */
export function ruleAt(box: Box, normal: Vec3, offset: number): Vec3 {
  const c = centre(box)
  const half = [0, 1, 2].map((i) => (box.max[i] - box.min[i]) / 2)
  const gap = Math.max(4, 0.08 * Math.max(...half) * 2)
  const flat = Math.hypot(normal[0], normal[1])
  let to: Vec3
  if (flat > 0.2) {
    // Square to the normal on the ground, on the +x, +y side: the right of the view from the corner the camera starts at, clear of the reed.
    let s: [number, number] = [-normal[1] / flat, normal[0] / flat]
    if (s[0] + s[1] < -1e-9 || (Math.abs(s[0] + s[1]) <= 1e-9 && s[1] < 0)) s = [-s[0], -s[1]]
    to = [s[0] * (Math.abs(s[0]) * half[0] + Math.abs(s[1]) * half[1] + gap), s[1] * (Math.abs(s[0]) * half[0] + Math.abs(s[1]) * half[1] + gap), -half[2]]
  } else to = [half[0] + gap, -(half[1] + gap), -half[2]]
  // Only what is square to the normal.
  const along = to[0] * normal[0] + to[1] * normal[1] + to[2] * normal[2]
  return [0, 1, 2].map((i) => c[i] + to[i] - normal[i] * along + normal[i] * offset + 0) as Vec3
}

/** A point of the plane's rectangle to tie its tag to: the middle of the edge that is highest, or of the back one where the plane lies flat. */
export function ruleSubject(plane: SectionPlane, box: Box): Vec3 {
  const rect = planeRect(plane, box)
  const n = plane.normal
  const u = rect.u
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
  const edges: Array<{ dir: Vec3; reach: number }> = [
    { dir: u, reach: rect.width / 2 },
    { dir: u.map((c) => -c + 0) as Vec3, reach: rect.width / 2 },
    { dir: v, reach: rect.height / 2 },
    { dir: v.map((c) => -c + 0) as Vec3, reach: rect.height / 2 }
  ]
  const topmost = edges.reduce((a, b) => (b.dir[2] > a.dir[2] + 1e-9 ? b : a))
  const lies = topmost.dir[2] < 0.5
  const pick = lies ? edges.reduce((a, b) => (b.dir[1] > a.dir[1] + 1e-9 ? b : a)) : topmost
  return rect.centre.map((c, i) => c + pick.dir[i] * pick.reach) as Vec3
}

/** The least and the greatest offset of a plane across a box, and where this plane is: what the rule is drawn from. */
export function ruleOf(plane: SectionPlane, box: Box): { min: number; max: number; offset: number } {
  const { min, max } = sectionExtent(box, plane.normal)
  return { min, max, offset: sectionOffset(plane, box) }
}
