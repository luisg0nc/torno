import { type ShownDimension, measuredValue, offBy, shownDimension, unitOf, valueText, verdictOf } from './dimension'
import type { DimensionMark } from './marks'
import { type SizeFact, type SizeSource, parseSize } from './size'

// Tying a size of the brief to a dimension: the size sets the dimension's expected value and its tolerance, and the
// size takes the dimension's verdict on the build on show. No second set of numbers and no new kind of check: the dimension
// is the check, and `expectedFrom` on it says whose number it holds. Main writes both (`main/board/ties.ts`); the page, the
// prompts and the tools read them through what is here.

/** How far off a size a dimension may be, by where the size came from (mm, or degrees for an angle): a measured size ±0.5, a datasheet's ±0.2, a guess ±2. */
export const TOLERANCE_OF_SOURCE: Record<SizeSource, number> = {
  measured: 0.5,
  'from a manual or datasheet': 0.2,
  'a guess': 2,
  'from Claude': 0.5
}

/** The tolerance a size is tied with when none is chosen. */
export const tieToleranceFor = (size: Pick<SizeFact, 'source'>): number => TOLERANCE_OF_SOURCE[size.source]

/** The number a size sets on a dimension, or why it has none: a list (`186 × 128`) and words are no one number. */
export function tieNumber(size: Pick<SizeFact, 'value' | 'unit'>): number | string {
  const parsed = parseSize(size.value, size.unit)
  if (!parsed) return `"${size.value}" is not a number a dimension can hold to: give the size as one number, such as 96.5.`
  if (parsed.numbers.length !== 1) return `"${size.value}" is ${parsed.numbers.length} numbers, and a dimension holds to one: tie one size to each.`
  return parsed.numbers[0]
}

/** Why a dimension cannot check a size, or null when it can: the unit and the kind of measurement must agree, and it must still be measured. */
export function tieRefusal(size: SizeFact, mark: DimensionMark): string | null {
  const number = tieNumber(size)
  if (typeof number === 'string') return number
  if (mark.status === 'resolved') return `${mark.id} is resolved, so it is no longer measured: another dimension can check this size.`
  if (unitOf(mark.measure) !== size.unit) return `${mark.id} measures in ${unitOf(mark.measure)} and this size is in ${size.unit}.`
  const sign = parseSize(size.value, size.unit)?.mark
  if (sign === 'Ø' && mark.measure !== 'diameter') return `This size is a diameter and ${mark.id} is a ${mark.measure}.`
  if (sign === 'R' && mark.measure !== 'radius') return `This size is a radius and ${mark.id} is a ${mark.measure}.`
  return null
}

/** What a dimension would say of a size on the build `revision`, before it is tied: holds, fails, or nothing yet (no value of that build). */
export function wouldSay(size: SizeFact, mark: DimensionMark, tolerance: number, revision: number | undefined): 'would hold' | 'would fail' | 'not measured on this build' {
  const number = tieNumber(size)
  const value = measuredValue(mark, revision)
  if (typeof number === 'string' || value === undefined) return 'not measured on this build'
  return verdictOf({ measure: mark.measure, value, expected: number, tolerance }) === 'pass' ? 'would hold' : 'would fail'
}

/** What a tied size reads against the build on show. */
export type TieReading =
  /** Nothing checks it: no tie, or a tie to something that is not there. */
  | { state: 'none'; gone?: string }
  | {
      state: 'holds' | 'fails' | 'unmeasured'
      mark: string
      /** Said in words: the build and what the dimension reads. */
      reading: string
      /** The dimension's value on the build on show, and the band it is held to: what the gauge draws. */
      value: number | null
      lo: number
      hi: number
      shown: ShownDimension
    }

/** A size's reading against the build `revision`, from the dimension it is tied to (undefined: not among the marks). */
export function tieReading(size: SizeFact, mark: DimensionMark | undefined, revision: number | undefined): TieReading {
  if (!size.tie) return { state: 'none' }
  if (!mark || mark.kind !== 'dimension') return { state: 'none', gone: size.tie.mark }
  const shown = shownDimension(mark, revision)
  const expected = mark.expected ?? (typeof tieNumber(size) === 'number' ? (tieNumber(size) as number) : 0)
  const tolerance = mark.tolerance ?? size.tie.tolerance
  const value = measuredValue(mark, revision) ?? null
  const band = { lo: expected - tolerance, hi: expected + tolerance }
  const state = shown.verdict === 'pass' ? 'holds' : shown.verdict === 'fail' ? 'fails' : 'unmeasured'
  const reading =
    value === null
      ? `${mark.id}: ${shown.text}`
      : `${mark.id} reads ${valueText(mark.measure, value)}${state === 'fails' ? `, ${offBy(value, expected)}` : ''}`
  return { state, mark: mark.id, reading, value, ...band, shown }
}

/** How many sizes hold, fail and have no check among the readings: the head of the ledger. `unmeasured` ones are tied and have no value of the build yet. */
export function tallyReadings(readings: readonly TieReading[]): { holds: number; fails: number; unmeasured: number; unchecked: number } {
  const count = (state: string): number => readings.filter((r) => r.state === state).length
  return { holds: count('holds'), fails: count('fails'), unmeasured: count('unmeasured'), unchecked: count('none') }
}

/** The head over the sizes: `7 sizes, 4 hold, 1 fails, 2 not checked`; the parts that are zero are left out. */
export function sizesTold(total: number, tally: ReturnType<typeof tallyReadings>): string {
  if (total === 0) return 'none yet'
  const parts = [`${total} size${total === 1 ? '' : 's'}`]
  if (tally.holds > 0) parts.push(`${tally.holds} hold`)
  if (tally.fails > 0) parts.push(`${tally.fails} ${tally.fails === 1 ? 'fails' : 'fail'}`)
  if (tally.unmeasured > 0) parts.push(`${tally.unmeasured} not measured on this build`)
  if (tally.unchecked > 0) parts.push(`${tally.unchecked} not checked`)
  return parts.join(', ')
}

/** What the chip of a tied dimension adds after its verdict: `brief 96.5`. */
export const briefChip = (mark: Pick<DimensionMark, 'expected' | 'expectedFrom'>): string | undefined => (mark.expectedFrom !== undefined && mark.expected !== undefined ? `brief ${mark.expected}` : undefined)
