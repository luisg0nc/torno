import { number } from '../../shared/format'
import { isSize, sourceOf, splitSource, unitMark, unitOf } from '../../shared/params'
import { MOST_MEASURED, type ShelfPart } from '../../shared/shelf'
import { ruleKindOf, type RuleKind } from './shelf'

// The ledger of an opened part (#352): one row a size, and what the person's "I measured it" says to Claude. Pure; the page is ui/shelf/PartPage.tsx.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day `YYYY-MM-DD` as `26 Nov`; anything else as it is. */
export function dayText(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day)
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return day
  return `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}`
}

/** What the person typed as the size they measured: a number with a point or a comma, more than 0 and less than 10,000 (main checks it again); null for anything else. */
export function measuredValue(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const value = Number(t)
  return Number.isFinite(value) && value > 0 && value < MOST_MEASURED ? value : null
}

/** What "Ask Claude about it" leaves in the box, for the person to finish: the box adds the space after it. */
export const askAboutText = (id: string): string => `About the shelf's ${id}:`

/** What "I measured it" leaves in the box once main has written the value and the day: the value in full. */
export const measuredRequest = (id: string, name: string, value: number): string =>
  `In the shelf's ${id}, set ${name} to ${String(value)}: I measured it on the part. Make its comment measured.`

/** How the source word of a row is read: assumed is warm, measured green, a quiet one is a listing, a derived or an assumed one that was since checked. */
export type WordTone = 'warn' | 'ok' | 'quiet' | 'plain'

export type LedgerEnd =
  /** Not checked on the part yet: the row offers "I measured it…". */
  | { kind: 'ask' }
  /** Worked out from the other sizes: there is nothing to measure. */
  | { kind: 'maker' }
  /** Checked on the part: the day, the value then, and whether it is not the one the part says (Claude has not changed it yet). */
  | { kind: 'checked'; day: string; at: string; differs: boolean }

export interface LedgerRow {
  name: string
  /** The part's value, as the kernel read the field's default. */
  value: number
  valueText: string
  /** The mark of its unit (`mm`, `°`), '' for none. */
  unit: string
  /** The comment after its source word. */
  what: string
  /** The source word as the model wrote it (`datasheet EC11`), '' for none. */
  word: string
  tone: WordTone
  kind: RuleKind
  end: LedgerEnd
}

/** The rows of the ledger: each size of the part, in its order. */
export function ledgerOf(part: Pick<ShelfPart, 'params' | 'checked'>): LedgerRow[] {
  return part.params.filter(isSize).map((p) => {
    const value = p.default as number
    const source = sourceOf(p.doc)
    const kind = ruleKindOf(part, p)
    const { source: said, rest } = splitSource(p.doc)
    const check = part.checked[p.name]
    const tone: WordTone = source === 'measured' ? 'ok' : kind === 'as' ? 'warn' : kind === 'mo' || source === 'listing' || (kind === 'ck' && source !== 'unsaid') ? 'quiet' : 'plain'
    const end: LedgerEnd = check
      ? { kind: 'checked', day: dayText(check.date), at: number(check.value), differs: Math.abs(check.value - value) > 1e-6 }
      : source === 'derived'
        ? { kind: 'maker' }
        : { kind: 'ask' }
    return { name: p.name, value, valueText: number(value), unit: unitMark(unitOf(p)), what: rest.trim(), word: said.replace(/:$/, ''), tone, kind, end }
  })
}
