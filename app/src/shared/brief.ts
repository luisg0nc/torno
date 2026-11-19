import { type BoardFile, type Card, readingOrder } from './board'

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
    rulesFrame: frame?.id ?? null
  }
}
