import { number } from '../../../shared/format'
import type { Mark } from '../../../shared/marks'
import type { BuildDigest, DigestPart, Verdict } from '../../../shared/sanity'

/** What the slip of a build is drawn from: the digest of the build, and the marks, for the words and values of the dimensions it flipped. */
export interface BuildLineData {
  digest: BuildDigest
  marks?: readonly Mark[]
}

/** A dimension whose verdict the build changed. */
export interface Flip {
  id: string
  /** What the person called it (the note of its mark), when the mark is known. */
  name?: string
  /** What the kernel measured on the build before and on this one, `2.8` and `3`, and the unit; only when the mark kept both. */
  from?: string
  to?: string
  unit?: 'mm' | '°'
  now: Verdict
  word: string
}

/** One changed part, as the table says it: every number through `shared/format.ts`, `≈` on all three of a volume that is not exact. */
export interface SlipRow {
  part: string
  before: string
  after: string
  change: string
  exact: boolean
  /** The two volumes in full, for the number that counts up from the one to the other. */
  from: number
  to: number
}

export interface SlipTable {
  flips: Flip[]
  rows: SlipRow[]
  /** The changed parts the rows leave out, for the slip to unfold. */
  hidden: number
  /** The parts that are as they were. */
  unchanged: number
}

/** The most parts the slip shows before it counts the rest. */
export const MOST_ROWS = 6

/** What a dimension's verdict became, in a word. */
export function verdictWord(now: Verdict): string {
  return now === 'pass' ? 'now passes' : now === 'fail' ? 'now fails' : 'is no longer measured'
}

/** What a mark measured on a build of this run, when it kept it. */
const sampled = (mark: Mark | undefined, revision: number | undefined): number | undefined =>
  mark?.kind === 'dimension' && revision !== undefined ? mark.history?.findLast((sample) => sample.revision === revision)?.value : undefined

function flipOf(change: BuildDigest['dimensions'][number], digest: BuildDigest, marks: readonly Mark[]): Flip {
  const mark = marks.find((m) => m.id === change.id)
  const from = sampled(mark, digest.since)
  const to = sampled(mark, digest.revision)
  const name = mark?.note.trim()
  return {
    id: change.id,
    ...(name ? { name } : {}),
    ...(from !== undefined && to !== undefined && from !== to ? { from: number(from), to: number(to), unit: mark?.kind === 'dimension' && mark.measure === 'angle' ? ('°' as const) : ('mm' as const) } : {}),
    now: change.now,
    word: verdictWord(change.now)
  }
}

/** The change of a part's volume, said as the digest said it: a percent where the part had a volume, the number of mm³ where it had none, its faces where only they moved. */
function changeOf(part: DigestPart): string {
  const { before, after, change, percent } = part.volume
  const sign = (n: number): string => (n > 0 ? '+' : '')
  // A percent to the tenth, as the digest's own lines say it (`-8.1 %`): the fourth digit of one is no news.
  const tenth = (p: number): string => `${sign(p)}${number(Math.round(p * 10) / 10)} %`
  if (before === after) return part.faces.before !== part.faces.after ? `faces ${part.faces.before} → ${part.faces.after}` : '0 %'
  const said = percent !== undefined ? tenth(percent) : before !== 0 ? tenth((change / before) * 100) : `${sign(change)}${number(change)}`
  return part.volume.exact ? said : `≈ ${said}`
}

/**
 * The table of a build's slip, from its digest: the dimensions it flipped, and the parts it changed, biggest change of
 * volume first, in rows of the part, its volume on the build before and on this one, and the change. At most `max`
 * rows; the rest are counted in `hidden`. No number is worked out here that the kernel did not give, but the percent
 * of a part that came with none.
 */
export function slipTable(line: BuildLineData, max = MOST_ROWS): SlipTable {
  const { digest } = line
  const sorted = [...digest.parts].sort((a, b) => Math.abs(b.volume.change) - Math.abs(a.volume.change))
  const rows = sorted.slice(0, max).map((part): SlipRow => {
    const mark = part.volume.exact ? '' : '≈ '
    return { part: part.name, before: `${mark}${number(part.volume.before)}`, after: `${mark}${number(part.volume.after)}`, change: changeOf(part), exact: part.volume.exact, from: part.volume.before, to: part.volume.after }
  })
  return {
    flips: digest.dimensions.map((change) => flipOf(change, digest, line.marks ?? [])),
    rows,
    hidden: Math.max(0, sorted.length - rows.length),
    unchanged: digest.unchanged
  }
}
