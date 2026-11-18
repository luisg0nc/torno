import { number } from './format'
import type { DimensionMark, DimensionSample, Mark, MeasureKind } from './marks'

/** How far off its expected value a dimension may be when nothing says: 0.05 mm, and 0.1° for an angle. */
export function defaultTolerance(measure: MeasureKind): number {
  return measure === 'angle' ? 0.1 : 0.05
}

/**
 * What a tolerance is compared with beyond itself: 8.05 against 8 ± 0.05 passes, whatever the last bit of the
 * subtraction says. It is the least difference that is written as other than 0 (`number`): nothing fails by `0 over`.
 */
const SLACK = 1e-6

/**
 * Whether a measured value is what was expected: within the tolerance (the
 * default of its kind when none is given), the bound included. Undefined
 * without a value or without an expectation: there is nothing to judge.
 */
export function verdictOf(mark: Pick<DimensionMark, 'measure' | 'value' | 'expected' | 'tolerance'>): 'pass' | 'fail' | undefined {
  if (mark.value === undefined || mark.expected === undefined) return undefined
  const tolerance = mark.tolerance ?? defaultTolerance(mark.measure)
  return Math.abs(mark.value - mark.expected) <= tolerance + SLACK ? 'pass' : 'fail'
}

/**
 * Whether an open dimension has not been measured on the build there is: what
 * it holds is then of an older build, or of an earlier run, and is no value
 * of this one. `revision` is that of the last build that worked. With none
 * there is nothing it was measured on: a dimension read from its file is not
 * measured until the first build of the run.
 */
export function isUnmeasured(mark: DimensionMark, revision: number | undefined): boolean {
  if (mark.status === 'resolved') return false
  return !(revision !== undefined && revision > 0 && mark.measuredRevision === revision)
}

/**
 * The value the kernel last gave a dimension, on whichever build that was.
 * None for one that lost the part of an end: nothing is measured from there.
 */
export function lastValue(mark: DimensionMark): number | undefined {
  return mark.anchorState === 'orphaned' ? undefined : mark.value
}

/**
 * The value a dimension may be said to have on the build `revision`: the
 * kernel's, measured on that build. Undefined otherwise: a value of another
 * build is never given as that of this one (`isUnmeasured`), and a dimension
 * the kernel could not measure, or whose part is gone, has none. One whose
 * end the build moved is measured from what is under it now, and has a value.
 *
 * This is the one rule for whatever tells of an open dimension: its line and
 * its data for the agent, and, through `shownDimension`, its row and its chip
 * on the part and in a picture. A resolved one is no longer measured, and what
 * it holds is told as of the build it was last measured on (`shownDimension`,
 * and `markData` and `describeMark` in main).
 */
export function measuredValue(mark: DimensionMark, revision: number | undefined): number | undefined {
  return isUnmeasured(mark, revision) ? undefined : lastValue(mark)
}

/**
 * How a dimension stands on the build `revision`, as a check of the part:
 * `unmeasurable` when it has no value there and can have none (its part is
 * gone, or the kernel refused), `unmeasured` when what it holds is not of
 * that build, `fail` or `pass` against what is expected of it, and `measured`
 * when nothing is.
 */
export type DimensionStanding = 'unmeasured' | 'unmeasurable' | 'fail' | 'pass' | 'measured'
export function standingOf(mark: DimensionMark, revision: number | undefined): DimensionStanding {
  if (mark.anchorState === 'orphaned') return 'unmeasurable'
  if (isUnmeasured(mark, revision)) return 'unmeasured'
  if (mark.value === undefined) return 'unmeasurable'
  return mark.verdict ?? 'measured'
}

/**
 * The open dimensions among some marks by how the build `revision` stands to them: those that fail what is
 * expected of them, those with no value of that build (not measured on it, or not measurable), and those that
 * pass. Resolved ones are no longer checks of the part, and are in none. The first two are the ones the build
 * does not meet.
 */
export function unmetDimensions(marks: readonly Mark[], revision: number | undefined): { failing: DimensionMark[]; unmeasured: DimensionMark[]; passing: DimensionMark[] } {
  const open = marks.filter((m): m is DimensionMark => m.kind === 'dimension' && m.status !== 'resolved')
  const standing = (m: DimensionMark): DimensionStanding => standingOf(m, revision)
  return {
    failing: open.filter((m) => standing(m) === 'fail'),
    unmeasured: open.filter((m) => standing(m) === 'unmeasured' || standing(m) === 'unmeasurable'),
    passing: open.filter((m) => standing(m) === 'pass')
  }
}

/**
 * Whether a mark is a check of the part: an open dimension with something expected of it. One with nothing
 * expected was kept to be read, not to be checked.
 */
export function isCheck(mark: Mark): mark is DimensionMark {
  return mark.kind === 'dimension' && mark.status !== 'resolved' && mark.expected !== undefined
}

/** The checks among some marks (`isCheck`) by how the build `revision` stands to them (`unmetDimensions`). */
export function checksOf(marks: readonly Mark[], revision: number | undefined): { failing: DimensionMark[]; unmeasured: DimensionMark[]; passing: DimensionMark[] } {
  return unmetDimensions(marks.filter(isCheck), revision)
}

/** The verdict a dimension has on the build `revision`: none without a value of that build. */
export function verdictOn(mark: DimensionMark, revision: number | undefined): 'pass' | 'fail' | undefined {
  return measuredValue(mark, revision) === undefined ? undefined : mark.verdict
}

/**
 * Why a dimension with an end on an edge has no value when that edge is not
 * under the end on the build `revision`: main says it (`refused`), and the
 * window knows it again by `isOffEdge`, to say what can be done about it.
 */
export function offEdgeReason(edge: string, revision: number): string {
  return `the edge ${edge} it was on is not under its end on r${revision}`
}
export function isOffEdge(refused: string | undefined): boolean {
  return refused !== undefined && /^the edge \S+ it was on is not under its end on r\d+$/.test(refused)
}

/**
 * Whether a reason says that torno set the parts apart for display, so that
 * what was asked between them is not the model's (`spreadApart` and
 * `spreadReason` in main/marks/spread.ts say so in these words). The window
 * knows it again, to say it in a line of its own.
 */
export function isSpreadRefusal(reason: string | undefined): boolean {
  return reason !== undefined && /\btorno (spread|moved) .+ for display\b/.test(reason)
}

/** `not measured on r12`: said of a dimension in place of a value that is not of the build there is; `not measured` when there is no build. */
export function unmeasuredText(revision: number | undefined): string {
  return revision !== undefined && revision > 0 ? `not measured on r${revision}` : 'not measured'
}

/** `r11`, or `an earlier build` of one that is not known: how the build a value is of is named, everywhere. */
export function onBuild(revision: number | undefined): string {
  return revision === undefined ? 'an earlier build' : `r${revision}`
}

/**
 * What is said in place of the value of an open dimension that has none of
 * the build `revision`. One that says of no build that it was measured on it
 * (`measuredRevision`: read from its file, where that is of another run, or
 * never measured) is `not measured yet`: what it holds is of no build that
 * can be named, and the pass after the next build measures it.
 */
export function notMeasuredText(mark: Pick<DimensionMark, 'measuredRevision'>, revision: number | undefined): string {
  return mark.measuredRevision === undefined ? 'not measured yet' : unmeasuredText(revision)
}

/** The unit a kind of measurement is in, as it is written after a number: with a space before `mm`, none before `°`. */
export function unitOf(measure: MeasureKind): '°' | 'mm' {
  return measure === 'angle' ? '°' : 'mm'
}

/** A value in full, with its unit: what a rounded one stands for (`8.0000001 mm`, `45.00000001°`). */
export function exactText(measure: MeasureKind, value: number): string {
  return measure === 'angle' ? `${value}°` : `${value} mm`
}

/** A value of a kind of measurement as it is shown: `6 mm`, `⌀ 8 mm`, `R 4 mm`, `45°`. At most four significant digits. */
export function valueText(measure: MeasureKind, value: number): string {
  if (measure === 'angle') return `${number(value)}°`
  return `${measure === 'diameter' ? '⌀ ' : measure === 'radius' ? 'R ' : ''}${number(value)} mm`
}

/** A value as the parts of a large reading: its sign (`⌀ `, `R `), the number and the unit, which put together are `valueText`. */
export function valueParts(measure: MeasureKind, value: number): { prefix: string; number: string; unit: '°' | 'mm' } {
  return { prefix: measure === 'diameter' ? '⌀ ' : measure === 'radius' ? 'R ' : '', number: number(value), unit: unitOf(measure) }
}

/** What stands for the value of a dimension that has none. */
export const NO_VALUE = '—'

/** What a dimension is said to be when it has no value and can have none on the build shown. */
export const NOT_MEASURABLE = 'not measurable'

/**
 * What is shown of a dimension on the build `revision`: in its row, on its
 * chip and in a picture. One rule for all of them.
 *
 * - `value` (and `verdict`, when something is expected): it was measured on
 *   that build, and `text` is that value.
 * - `stale`: `text` is a value of another build, `of` when that is known. It
 *   is shown greyed, with no tick or cross, and `note` says what it is: what
 *   an open dimension was, or what a resolved one, which is no longer
 *   measured, was last measured as.
 * - `none`: `text` says in words that there is no value.
 */
export interface ShownDimension {
  text: string
  value?: number
  verdict?: 'pass' | 'fail'
  stale?: true
  of?: number
  none?: true
  note?: string
}

export function shownDimension(mark: DimensionMark, revision: number | undefined): ShownDimension {
  const last = lastValue(mark)
  const of = mark.measuredRevision === undefined ? {} : { of: mark.measuredRevision }
  const current = (value: number): ShownDimension => ({ text: valueText(mark.measure, value), value, ...(mark.verdict ? { verdict: mark.verdict } : {}) })
  if (mark.status === 'resolved') {
    if (last === undefined) return { text: 'not measured', none: true, note: 'resolved: it is no longer measured' }
    if (revision !== undefined && mark.measuredRevision === revision) return current(last)
    return { text: valueText(mark.measure, last), stale: true, ...of, note: `as measured on ${onBuild(mark.measuredRevision)}: resolved, it is no longer measured` }
  }
  const value = measuredValue(mark, revision)
  if (value !== undefined) return current(value)
  if (standingOf(mark, revision) === 'unmeasurable') return { text: NOT_MEASURABLE, none: true }
  if (last === undefined || mark.measuredRevision === undefined) return { text: notMeasuredText(mark, revision), none: true }
  return { text: valueText(mark.measure, last), stale: true, ...of, note: `${unmeasuredText(revision)}: this is what it was on ${onBuild(mark.measuredRevision)}` }
}

/** A dimension's value on the build `revision` as it is shown beside its number where there is room for no more; `—` when it has none there. */
export function dimensionText(mark: DimensionMark, revision: number | undefined): string {
  const shown = shownDimension(mark, revision)
  return shown.value === undefined ? NO_VALUE : shown.text
}

/** `8.5 ± 0.05`: what a dimension should measure, with the tolerance that applies. Full precision, as typed. */
export function expectedText(mark: Pick<DimensionMark, 'measure' | 'expected' | 'tolerance'>): string {
  return `${mark.expected} ± ${mark.tolerance ?? defaultTolerance(mark.measure)}`
}

/**
 * What a dimension is worth on the build `revision`, with what was expected of it: `6 mm, expected 8 ± 0.05`
 * (`⌀ 8 mm, expected 8.5 ± 0.05`). Nothing for one with no value of that build or nothing expected.
 */
export function valueAgainstExpected(mark: DimensionMark, revision: number | undefined): string | undefined {
  const value = measuredValue(mark, revision)
  if (value === undefined || mark.expected === undefined) return undefined
  return `${valueText(mark.measure, value)}, expected ${expectedText(mark)}`
}

/** `0.5 under`, `0.2 over`: how far a value is from what was expected, and which way. */
export function offBy(value: number, expected: number): string {
  const by = value - expected
  return `${number(Math.abs(by))} ${by < 0 ? 'under' : 'over'}`
}

/** How many builds of a run a dimension remembers. */
export const HISTORY_LENGTH = 20

/**
 * A history with what the kernel said on a build added to it: oldest first, a build once (the later word replaces
 * the earlier), the last `HISTORY_LENGTH` kept. A new history; the one given is not changed.
 */
export function withSample(history: readonly DimensionSample[] | undefined, sample: DimensionSample): DimensionSample[] {
  const kept = (history ?? []).filter((one) => one.revision !== sample.revision)
  return [...kept, sample].sort((a, b) => a.revision - b.revision).slice(-HISTORY_LENGTH)
}

/** A sample of a dimension's history with its verdict, worked out from what is expected of it now. */
export interface JudgedSample extends DimensionSample {
  verdict?: 'pass' | 'fail'
}

/** The history of a dimension, each build with the verdict its value has against what is expected now. */
export function samplesOf(mark: DimensionMark): JudgedSample[] {
  return (mark.history ?? []).map((sample) => {
    const verdict = verdictOf({ measure: mark.measure, value: sample.value, expected: mark.expected, tolerance: mark.tolerance })
    return verdict ? { ...sample, verdict } : { ...sample }
  })
}

/** Since which build a check has stood as it does on the build there is, and the last build before that it stood the other way. */
export interface Since {
  state: 'pass' | 'fail'
  since: number
  /** The last build before `since` that had the other verdict. */
  other?: number
  /** How many builds of the history it has stood so. */
  builds: number
}

/**
 * How a check stands against its own past, when that is worth saying: it has a verdict on the build `revision`
 * (the last one in its history), and either it was the other way on an earlier build, or it fails and has on
 * more than one. A build with no value neither breaks a run nor ends it.
 */
export function since(mark: DimensionMark, revision: number | undefined): Since | undefined {
  if (mark.status === 'resolved' || revision === undefined) return undefined
  const judged = samplesOf(mark).filter((sample) => sample.verdict !== undefined)
  const last = judged[judged.length - 1]
  if (!last || last.revision !== revision || !last.verdict) return undefined
  let run = judged.length
  while (run > 0 && judged[run - 1].verdict === last.verdict) run -= 1
  const builds = judged.length - run
  const other = run > 0 ? judged[run - 1].revision : undefined
  if (other === undefined && !(last.verdict === 'fail' && builds > 1)) return undefined
  return { state: last.verdict, since: judged[run].revision, ...(other === undefined ? {} : { other }), builds }
}

/** `fails since r12; passed on r11`, `passes since r5; failed on r4`, `fails since r2; never passed this run`. */
export function sinceText(s: Since): string {
  const now = s.state === 'fail' ? 'fails' : 'passes'
  if (s.other === undefined) return `${now} since r${s.since}; never passed this run`
  return `${now} since r${s.since}; ${s.state === 'fail' ? 'passed' : 'failed'} on r${s.other}`
}
