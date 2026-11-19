import { checksOf } from '../../../shared/dimension'
import type { DimensionMark, Mark } from '../../../shared/marks'

/** What is on the parts in hand: the checks that fail and hold on them (a dimension with an end on one), and the other open marks anchored on them. */
export interface OnIt {
  failing: string[]
  holding: string[]
  marks: number
}

/** The parts the refs are on, each once, in order; a stroke of a sketch is on no part. A ref is `lid`, `lid/F12` or `lid/E3`. */
export function partsOfRefs(refs: readonly string[], isStroke: (ref: string) => boolean): string[] {
  const parts: string[] = []
  for (const ref of refs) {
    if (isStroke(ref)) continue
    const part = /^(.+)\/[FE]\d+$/.exec(ref)?.[1] ?? ref
    if (!parts.includes(part)) parts.push(part)
  }
  return parts
}

/** What is on `parts` on the build `revision`. */
export function onIt(marks: readonly Mark[], revision: number | undefined, parts: readonly string[]): OnIt {
  const on = (m: DimensionMark): boolean => [m.a, m.b].some((end) => end?.part !== undefined && parts.includes(end.part))
  const { failing, passing } = checksOf(marks, revision)
  const checks = new Set([...failing, ...passing].map((m) => m.id))
  return {
    failing: failing.filter(on).map((m) => m.id),
    holding: passing.filter(on).map((m) => m.id),
    marks: marks.filter((m) => m.status !== 'resolved' && !checks.has(m.id) && m.kind !== 'dimension' && 'anchor' in m && m.anchor?.part !== undefined && parts.includes(m.anchor.part)).length
  }
}

/** The line: `M9 fails, M7 M8 hold, 1 mark`; nothing when nothing is on it. */
export function onItSaid(on: OnIt): string {
  return [
    on.failing.length > 0 && `${on.failing.join(' ')} ${on.failing.length === 1 ? 'fails' : 'fail'}`,
    on.holding.length > 0 && `${on.holding.join(' ')} hold${on.holding.length === 1 ? 's' : ''}`,
    on.marks > 0 && `${on.marks} ${on.marks === 1 ? 'mark' : 'marks'}`
  ]
    .filter(Boolean)
    .join(', ')
}
