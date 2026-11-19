import { type CheckNote, type ModelCheck, againstText, noteText, readingText, wantedText } from '../../shared/modelChecks'

/** A check of the model in words, for its row: its name (the model's own words), how it stands in a word, and what was measured against what was wanted. */
export interface CheckWords {
  name: string
  /** How it stands, in a word: not colour alone. */
  standing: 'pass' | 'fails' | 'not measured' | 'not run'
  /** `0.12 mm`, or why it was not measured. */
  reading: string
  /** `wanted 0.15 to 0.25 mm`; empty when it could not be measured. */
  wanted: string
  /** Said where the number is not the kernel's exact one: found by sampling, or approximate. */
  caution: string | null
  /** `against an assumed reference: radiator`: the check holds only as far as the guessed sizes of that bought part do; null for none. */
  assumed: string | null
  /** The whole of it for hover: what the kernel says of how it was taken. */
  title: string
}

export function checkRow(c: ModelCheck): CheckWords {
  const measured = c.status === 'pass' || c.status === 'fail'
  const standing = c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fails' : c.status === 'error' ? 'not measured' : 'not run'
  const reading = measured ? readingText({ ...c, exact: undefined }) : (c.reason ?? '')
  const wanted = measured ? `wanted ${wantedText(c)}` : ''
  const caution = measured && c.exact === false ? (c.kind === 'thin' ? 'found by sampling' : 'approximate') : null
  return { name: c.name, standing, reading, wanted, caution, assumed: measured && againstText(c) ? againstText(c) : null, title: [c.how, c.layout ? `layout ${c.layout}` : null].filter(Boolean).join('; ') || c.name }
}

/** What was made easier to pass or taken out since it was first declared, one line each. */
export const noteLines = (notes: readonly CheckNote[]): string[] => notes.map(noteText)
