import type { HistoryEntry } from '../../../shared/history'
import { type Mark, markIntent } from '../../../shared/marks'
import { INTENT_CHIP, type Round, roundItems } from '../../../shared/reviews'

/** What an item says of itself in the panel besides its note: what the person made of Claude's answer, or that there is none. */
export type Said = `OK in ${string}` | 'OK (accepted)' | 'Still wrong' | 'Not answered yet' | ''

export interface RoundRow {
  id: string
  /** `− M8`, `+ M9` or `M10`: the sign is the person's want or don't want. */
  chip: string
  note: string
  /** Claude's `resolvedNote`, when it resolved the item. */
  resolved?: string
  /** `judge`: Claude resolved it and the person has not said OK or Still wrong yet. */
  can: 'judge' | 'none'
  said: Said
}

/** Where the reviewed build is shown against the live one, or why it is not. */
export type RoundCompare = { from: string; to: string } | { off: string }

/** The row of one item of a round. */
function rowOf(mark: Mark): RoundRow {
  const intent = markIntent(mark)
  const row = { id: mark.id, chip: intent ? `${INTENT_CHIP[intent]} ${mark.id}` : mark.id, note: mark.note, ...(mark.resolvedNote ? { resolved: mark.resolvedNote } : {}) }
  const judged = mark.judged
  if (mark.status === 'resolved') {
    // Only Claude's answer is the person's to judge. A judgment older than its answer (Still wrong, answered again) is no longer of it.
    if (mark.resolvedBy !== 'agent') return { ...row, can: 'none', said: '' }
    if (judged?.verdict === 'ok') return { ...row, can: 'none', said: `OK in ${judged.build}` }
    if (mark.acknowledged === true) return { ...row, can: 'none', said: 'OK (accepted)' }
    return { ...row, can: 'judge', said: '' }
  }
  return { ...row, can: 'none', said: judged?.verdict === 'still-wrong' ? 'Still wrong' : 'Not answered yet' }
}

/**
 * What the round panel lists: a row for each item of the round, and whether the build it reviewed can be shown against the
 * newest one. Compare is off when the history has no `h41` (the build is no longer kept), when its `h41` has other sources
 * than the round's (the person's own build, not the reviewed one: the round came from another computer), and when nothing
 * was built since.
 */
export function roundRows(round: Round, marks: readonly Mark[], history: readonly HistoryEntry[]): { rows: RoundRow[]; compare: RoundCompare } {
  const rows = roundItems(marks, round.id).map(rowOf)
  const kept = history.find((entry) => entry.id === round.build)
  if (!kept) return { rows, compare: { off: 'the build is no longer kept' } }
  if (kept.sources !== round.sources) return { rows, compare: { off: 'the reviewed build is not on this computer' } }
  const newest = [...history].reverse().find((entry) => entry.failed !== true)
  if (!newest || newest.id === kept.id) return { rows, compare: { off: 'no build has been made since' } }
  return { rows, compare: { from: kept.id, to: newest.id } }
}

/** Which round of the follow-up this is: 1 for the first, 2 for what carried items on from it. */
export function roundNumber(round: Round, rounds: readonly Round[]): number {
  const seen = new Set<string>()
  let count = 1
  for (let at: Round | undefined = round; at?.from !== undefined && !seen.has(at.id); ) {
    seen.add(at.id)
    at = rounds.find((one) => one.id === at?.from)
    if (at) count += 1
  }
  return count
}
