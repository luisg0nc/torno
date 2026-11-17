import { type Mark, markIntent } from './marks'

/** A round's id: `R1`, `R2`, … per project, given by main from `nextRound` and never given again. */
export const ROUND_ID = /^R[1-9]\d{0,14}$/

/**
 * A review of one build: the marks the person makes while it is open are its items, held back until it is sent. Main's
 * alone, in `marks.json` beside the marks. At most one round of a project has no `endedAt`.
 */
export interface Round {
  id: string
  /** The history id of the build it reviews: `h41`. */
  build: string
  /** That build's sources hash: a local `h41` with another is not the round's build. */
  sources: string
  /** The one line the round's prompt carries. */
  line: string
  /** The layout it was started on: marks made in another layout do not join it. */
  layout: string
  startedAt: string
  /** Absent while it is open. */
  endedAt?: string
  /** When the prompt that carried it was delivered. A sent round is never reopened. */
  sentAt?: string
  /** When it was let go as plain marks: its items are ordinary drafts, and it is never sent. */
  plain?: string
  /** The round it carried items from (Still wrong). */
  from?: string
}

/** The rounds of a project, and which one is being sent now (main's, in memory: its items are let through to the prompt that is on its way). */
export interface RoundsView {
  rounds: Round[]
  sending: string | null
}

/** The round that is open: the one with no `endedAt`. */
export function openRound(rounds: readonly Round[]): Round | undefined {
  return rounds.find((round) => round.endedAt === undefined)
}

/** The marks that are in a round. */
export function roundItems(marks: readonly Mark[], id: string): Mark[] {
  return marks.filter((mark) => mark.round === id)
}

/** How many items of a round the person does not want, wants and says nothing of. */
export function roundCounts(marks: readonly Mark[], id: string): { dont: number; want: number; plain: number } {
  const counts = { dont: 0, want: 0, plain: 0 }
  for (const mark of roundItems(marks, id)) {
    const intent = markIntent(mark)
    counts[intent ?? 'plain'] += 1
  }
  return counts
}

/** `Review of h41 · 3 − · 2 +`: a count of none is left out. */
export function reviewName(round: Round, marks: readonly Mark[]): string {
  const { dont, want } = roundCounts(marks, round.id)
  return ['Review of ' + round.build, ...(dont > 0 ? [`${dont} −`] : []), ...(want > 0 ? [`${want} +`] : [])].join(' · ')
}

/**
 * The round that carried items on from `id` (what Still wrong makes) and can still take more: one that was sent or let go
 * as plain marks is not one, for an item put in it would go out alone.
 */
export function carriedRound(rounds: readonly Round[], id: string): Round | undefined {
  return rounds.find((round) => round.from === id && round.sentAt === undefined && round.plain === undefined)
}

/** A draft of a round that has not been sent, was not let go as plain marks and is not being sent now: it goes with no prompt. */
export function isHeld(mark: Mark, view: RoundsView): boolean {
  if (mark.status !== 'draft' || mark.round === undefined) return false
  const round = view.rounds.find((one) => one.id === mark.round)
  return round !== undefined && round.sentAt === undefined && round.plain === undefined && view.sending !== round.id
}

/** What the window asks of main about the rounds (`marks:round`): exactly one of these, naming a round by its `R<n>`. */
export type RoundAsk = { start: { layout: string } } | { end: string } | { reopen: string } | { carry: string } | { send: string } | { plain: string }
