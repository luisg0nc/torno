import { number } from '../../../shared/format'
import type { Mark, Vec3 } from '../../../shared/marks'
import type { Part } from '../../../shared/scene'
import type { Verdict } from '../../../shared/sanity'
import { labelAnchor } from '../../viewport/marks/markObjects'
import type { PartChange, TurnSummary } from '../chat/turnSummary'

// The pure rules of what Compare writes on the parts that changed (`CompareBar.tsx`, spec 2026-11-18 section 2 "Tags"): a few
// short tags with leaders, taken from the numbers of the turn's builds (`turnSummary`, the digests' parts), and the count of
// those left out, which the band says as "and N more". Nothing is worked out here that the kernel did not give.

/** One tag: what it is about (`M3`, a mark, or `assembly:tub`, a part's key in the scene) and what it says. */
export interface ChangeTag {
  subject: string
  text: string
}

/** What a dimension's verdict became, in the words of a tag. */
const DIMENSION: Record<Verdict, string> = { pass: 'now passes', fail: 'now fails', none: 'is no longer measured' }

/** A part in the words of a tag: its volume, `≈` where that is not exact, or only its faces where the volume is as it was. */
function partText(part: PartChange): string {
  const { before, after, exact } = part.volume
  if (before !== after) return `${part.name} volume ${exact ? '' : '≈ '}${number(before)} → ${number(after)} mm³`
  return `${part.name} faces ${part.faces.before} → ${part.faces.after}`
}

/** How much a part's volume moved, in mm³; none for a part whose volume is as it was. */
const moved = (part: PartChange): number => Math.abs(part.volume.after - part.volume.before)

/**
 * The tags of a turn's change, at most `max`: the dimensions whose verdict flipped first, then the parts whose volume changed
 * most (a part with only its faces changed after those), and `more`, how many were left out, with `rest` those themselves for the
 * band's list.
 */
export function changeTags(summary: TurnSummary, max = 4): { tags: ChangeTag[]; more: number; rest: ChangeTag[] } {
  const dimensions = summary.dimensions.map((d): ChangeTag => ({ subject: d.id, text: `${d.id} ${DIMENSION[d.now]}` }))
  const parts = [...summary.parts].sort((a, b) => moved(b) - moved(a)).map((part): ChangeTag => ({ subject: part.id, text: partText(part) }))
  const all = [...dimensions, ...parts]
  return { tags: all.slice(0, max), more: Math.max(0, all.length - max), rest: all.slice(max) }
}

/**
 * Where a tag stands: the middle of the part's box (its key, `assembly:tub`) in the scene, the anchor of the mark (`M3`) in the marks. Null
 * for what the build on show does not have (a part that is gone, a mark deleted), which the band lists instead.
 */
export function subjectPoint(subject: string, parts: readonly Pick<Part, 'key' | 'bbox'>[], marks: readonly Mark[]): Vec3 | null {
  if (/^M\d+$/.test(subject)) {
    const mark = marks.find((m) => m.id === subject)
    return mark ? labelAnchor(mark).point : null
  }
  const part = parts.find((part) => part.key === subject)
  if (!part) return null
  const { min, max } = part.bbox
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}
