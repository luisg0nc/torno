// The question of `AskUserQuestion` that offers a researched part to the parts shelf (#354). Claude writes it by the `torno-model` skill: the
// header `Shelf`, the question `Put <name> on the parts shelf?` and then one line a size, `<value> <what> (<source>)`. The card draws the
// size lines as a table. Pure; `ShelfOffer.tsx` draws it.
import { sourceOf } from '../../../shared/params'
import type { Question } from './ask'

/** How a source word is told: assumed is warm, measured green, a listing, a standard and a worked-out size quiet, any other as plain ink. */
export type OfferTone = 'warn' | 'ok' | 'quiet' | 'plain'

export interface OfferRow {
  value: string
  what: string
  /** The word as Claude wrote it in the brackets (`datasheet EC11`, `ISO 261`). */
  source: string
  tone: OfferTone
}

export type OfferBlock = { kind: 'text'; text: string } | { kind: 'rows'; rows: OfferRow[] }

export interface ShelfOffer {
  /** The question's first line. */
  title: string
  /** The other lines in their order: a run of size lines is one table, any other line is text. */
  blocks: OfferBlock[]
}

/** A value starts a size line: a number (`7.5`, `Ø7`, `M6`), several joined by `×` or `x` (`40.9 × 19.7`), then a unit if it has one. */
const SIZE = /^((?:[Øø⌀]\s*|M)?\d+(?:[.,]\d+)?(?:\s*[×x]\s*\d+(?:[.,]\d+)?)*(?:\s?(?:mm|°|deg))?)\s+(\S.*?)\s+\(([^()]+)\)$/

const toneOf = (source: string): OfferTone => {
  const kind = sourceOf(`${source}:`)
  return kind === 'assumed' ? 'warn' : kind === 'measured' ? 'ok' : kind === 'listing' || kind === 'standard' || kind === 'derived' ? 'quiet' : 'plain'
}

/**
 * The offer a question is, or null when it is an ordinary question: its header is `Shelf` (any case) and at least one line after the first reads as
 * a size. A line that does not read as one stays a line of text, so nothing Claude wrote is lost.
 */
export function shelfOffer(question: Pick<Question, 'question' | 'header'>): ShelfOffer | null {
  if (question.header.trim().toLowerCase() !== 'shelf') return null
  const [title, ...lines] = question.question.split('\n')
  const blocks: OfferBlock[] = []
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*•]\s+/, '')
    if (line === '') continue
    const m = SIZE.exec(line)
    const last = blocks.at(-1)
    if (m) {
      const row: OfferRow = { value: m[1], what: m[2], source: m[3].trim(), tone: toneOf(m[3].trim()) }
      if (last?.kind === 'rows') last.rows.push(row)
      else blocks.push({ kind: 'rows', rows: [row] })
    } else blocks.push({ kind: 'text', text: line })
  }
  return blocks.some((b) => b.kind === 'rows') ? { title: title.trim(), blocks } : null
}
