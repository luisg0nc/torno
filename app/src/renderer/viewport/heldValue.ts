import type { Vec3 } from '../../shared/marks'

/**
 * Where the reading of the last measurement stands: the middle of its line (the kernel's two points, or failing those the two
 * ends as they were clicked), the object frame. An angle is no line, and has its first end's point. This is the subject of
 * the measure tag (`ui/view/MeasureTag.tsx`), which holds the reading, in no picture for the agent.
 */
export function readingAt(held: { points?: [Vec3, Vec3]; a: { point: Vec3 }; b?: { point: Vec3 } }): Vec3 {
  const [from, to] = held.points ?? (held.b ? [held.a.point, held.b.point] : [held.a.point, held.a.point])
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]
}
