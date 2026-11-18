import type { ExportItem } from '../../../shared/exportdata'

// The rule of the export dock's weight (spec 2026-11-18, "Export, on the bench"): a rule from 0 to the budget, filled with the
// lines that are on, each its share of the budget, in the order the plan gives them. Pure: the component draws it.

/** What the rule needs of a line: what it is, what it weighs, and whether it goes. A line with no `on` goes. */
export type WeighedLine = Pick<ExportItem, 'kind' | 'bytes'> & { on?: boolean }

/** The lines the rule is made of: those that go and weigh something, in order. The segments are these, one each. */
export function weighed<T extends WeighedLine>(items: readonly T[]): T[] {
  return items.filter((item) => item.on !== false && item.bytes > 0)
}

export interface Rule {
  /** One for each line that goes and weighs something, in order: its share of the budget. Together they never come to more than 1. */
  segments: Array<{ kind: ExportItem['kind']; share: number }>
  /** What goes past the budget, as a share of the budget: 0 under it. Drawn on its own past the last tick. */
  over: number
  /** In bytes: 0, half the budget and the budget. */
  ticks: number[]
}

/**
 * The rule of a plan's lines against its budget. The lines fill the rule up to the budget; what is past it is not a line's
 * but the overflow's, `over`, so that the rule never claims more than the lines weigh in all.
 */
export function weighRule(items: readonly WeighedLine[], budget: number): Rule {
  const ticks = [0, budget / 2, budget]
  const lines = weighed(items)
  const total = lines.reduce((sum, line) => sum + line.bytes, 0)
  const segments: Rule['segments'] = []
  let left = 1
  for (const line of lines) {
    if (left <= 0) break
    const share = Math.min(line.bytes / budget, left)
    segments.push({ kind: line.kind, share })
    left -= share
  }
  return { segments, over: total > budget ? (total - budget) / budget : 0, ticks }
}
