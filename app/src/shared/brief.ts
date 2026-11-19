import { type BoardFile, type Card, readingOrder } from './board'
import { type SizeFact, parseSize } from './size'

// The brief page's reading of a project's board (`board.json`): the cards that say what the project is, sorted into the
// sections of the sheet. The file is not changed and nothing is dropped from it: a card of a kind the page does not draw
// (an old copy of a mark, a build, a frame's outline) simply is not a section's.

/** The name (lower case) of the frame whose text cards are the person's rules; `briefOf` in `main/board/text.ts` reads the same. */
export const RULES_FRAME = 'rules'

export interface BriefSections {
  /** Whether the board has the card of `brief.md`: the page shows the project's own words. */
  hasWhat: boolean
  /** Photos and doodles, to show beside what we are making. */
  pictures: Card[]
  /** STEP files and PDFs of `reference/`. */
  references: Card[]
  sizes: Card[]
  rules: Card[]
  /** Text cards of the person and Claude that are not rules (a link is one). */
  notes: Card[]
  /** The id of the frame named Rules, when the board has one. */
  rulesFrame: string | null
  /** What the person took off the page that main made by itself (the brief, a photo, a STEP file or a PDF): not lost, and shown again by "Show". */
  hidden: Card[]
}

const isPicture = (c: Card): boolean => c.kind === 'picture' || c.kind === 'sketch' || (c.kind === 'reference' && /\.(?:png|jpe?g|webp)$/i.test(c.source ?? ''))

export function briefSections(board: BoardFile): BriefSections {
  const cards = readingOrder(board.cards)
  const frame = cards.find((c) => c.kind === 'frame' && (c.name ?? '').trim().toLowerCase() === RULES_FRAME)
  const text = cards.filter((c) => c.kind === 'text')
  return {
    hasWhat: cards.some((c) => c.kind === 'brief'),
    pictures: cards.filter(isPicture),
    references: cards.filter((c) => c.kind === 'reference' && !isPicture(c)),
    sizes: cards.filter((c) => c.kind === 'size' && c.size !== undefined),
    rules: text.filter((c) => frame !== undefined && c.frame === frame.id),
    notes: text.filter((c) => frame === undefined || c.frame !== frame.id),
    rulesFrame: frame?.id ?? null,
    hidden: board.cards.filter((c) => c.hidden === true && (c.kind === 'brief' || c.kind === 'reference'))
  }
}

/** A size's value as the ledger shows it: the numbers read from it (`Ø 6.6`, `186 × 128`), or the value as typed when it is no numbers, with the unit it ends with left out. */
export function sizeValue(size: SizeFact): string {
  const parsed = parseSize(size.value, size.unit)
  if (parsed) return `${parsed.mark ? `${parsed.mark} ` : ''}${parsed.numbers.join(' × ')}`
  const text = size.value.trim()
  return text.toLowerCase().endsWith(size.unit) && text.length > size.unit.length ? text.slice(0, -size.unit.length).trimEnd() : text
}

/** Where a size came from, said as the ledger says it: the note after it. */
export function sizeSource(size: SizeFact): string {
  const from = size.source === 'from a manual or datasheet' ? 'from a datasheet' : size.source
  return size.note ? `${from} · ${size.note}` : from
}

/** The line over the sizes, for now with every size unchecked: `7 sizes, 7 not checked`. */
export function sizesSaid(sizes: number): string {
  return sizes === 0 ? 'none yet' : `${sizes} size${sizes === 1 ? '' : 's'}, ${sizes} not checked`
}

/** The line over the rules. */
export function rulesSaid(rules: number): string {
  return rules === 0 ? 'none yet' : `${rules} rule${rules === 1 ? '' : 's'}, ${rules} not checked`
}
