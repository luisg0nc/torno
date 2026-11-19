import { defaultTolerance, expectedText, isCheck, measuredValue, notMeasuredText, standingOf, valueText } from '../../../shared/dimension'
import type { DimensionMark, Mark } from '../../../shared/marks'
import type { ModelCheck } from '../../../shared/modelChecks'
import { checkRow } from '../checkRows'
import type { LitCheck } from './lit'

/** How a check stands, in the word its row says: not colour alone. */
export type Verdict = 'passes' | 'fails' | 'not run' | 'not measured'

/**
 * One row of the Checks section: a check of the model (`checks(p)`) or one of the person's dimensions (a mark that has something
 * expected of it). `id` names the row (the model's own name for its check, the mark's id for a dimension), `mark` is the
 * dimension's chip. `value`, `lo` and `hi` are the gauge's: the value measured on the build (none where it was not) and the band
 * wanted (null at an open end). `line` is the second line of the row, in words and numbers. `parts` are the parts the check is of.
 */
export interface CheckRow {
  kind: 'model' | 'dimension'
  id: string
  name: string
  verdict: Verdict
  value?: number
  lo?: number | null
  hi?: number | null
  line: string
  mark?: string
  /** The dimension's: who set it, the person or the agent. */
  author?: 'user' | 'agent'
  parts: string[]
  /** The model's: what the kernel says of how it was taken, for hover. */
  title?: string
}

/** Fails first, then what has no value of the build (not run, not measured), then what passes. */
const ORDER: Record<Verdict, number> = { fails: 0, 'not run': 1, 'not measured': 1, passes: 2 }

const names = (c: ModelCheck): string[] => [c.declared?.a, c.declared?.b].filter((p): p is string => typeof p === 'string')

function modelRow(c: ModelCheck): CheckRow {
  const words = checkRow(c)
  const measured = c.status === 'pass' || c.status === 'fail'
  const verdict: Verdict = c.status === 'pass' ? 'passes' : c.status === 'fail' ? 'fails' : c.status === 'error' ? 'not measured' : 'not run'
  // A caution the reading already says ("none found by sampling") is not said twice.
  const caution = words.caution !== null && !words.reading.includes(words.caution) ? words.caution : ''
  return {
    kind: 'model',
    id: c.name,
    name: c.name,
    verdict,
    ...(measured && typeof c.value === 'number' ? { value: c.value } : {}),
    lo: c.min ?? null,
    hi: c.max ?? null,
    line: [words.reading, words.wanted, caution, words.assumed].filter(Boolean).join(', '),
    parts: names(c),
    title: words.title
  }
}

function dimensionRow(m: DimensionMark, build: number): CheckRow {
  const standing = standingOf(m, build)
  const value = measuredValue(m, build)
  const verdict: Verdict = standing === 'fail' ? 'fails' : standing === 'pass' ? 'passes' : 'not measured'
  const tolerance = m.tolerance ?? defaultTolerance(m.measure)
  const expected = m.expected as number
  const parts = [m.a.part, m.b?.part].filter((p): p is string => p !== undefined)
  return {
    kind: 'dimension',
    id: m.id,
    mark: m.id,
    author: m.author,
    name: m.note || m.measure,
    verdict,
    ...(value === undefined ? {} : { value }),
    lo: expected - tolerance,
    hi: expected + tolerance,
    line: value === undefined ? (m.anchorState === 'orphaned' ? 'not measurable' : notMeasuredText(m, build)) : `${valueText(m.measure, value)}, wanted ${expectedText(m)}`,
    parts: [...new Set(parts)]
  }
}

/**
 * The model's own checks and the person's dimension checks as one list, failing first, then those not run or not measured, then
 * those that pass; the order given within each (the model's before the person's). `build` is the revision on show: a dimension
 * measured on another has no value of it.
 */
export function mergedChecks(model: readonly ModelCheck[], dimensions: readonly Mark[], build: number): CheckRow[] {
  return [...model.map(modelRow), ...dimensions.filter(isCheck).map((m) => dimensionRow(m, build))]
    .map((row, at) => ({ row, at }))
    .sort((a, b) => ORDER[a.row.verdict] - ORDER[b.row.verdict] || a.at - b.at)
    .map(({ row }) => row)
}

/** The rows of the checks as the view's lighting reads them (`litRows`): an entry for each part a check is of. */
export const litChecks = (rows: readonly CheckRow[]): LitCheck[] => rows.flatMap((r) => r.parts.map((part) => ({ id: r.id, part })))
