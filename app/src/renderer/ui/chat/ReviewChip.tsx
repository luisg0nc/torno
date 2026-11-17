import type { Mark } from '../../../shared/marks'
import { type Round, type RoundsView, isHeld, reviewName } from '../../../shared/reviews'
import { reviewActions, useReview } from '../../state/review'
import { useStore } from '../../state/store'

/**
 * The review that goes with the next prompt, as a chip: `Review of h41 · 3 − · 2 +`, set in the face of numbers, with
 * "Remove", which lets the round go as plain marks (ordinary drafts with their intents, the round never sent as a review).
 * It is the round's name from the marks it has now, so an item taken out of it changes it.
 */
export function ReviewChipView({ round, marks }: { round: Round; marks: readonly Mark[] }) {
  return (
    <div className="chat-board-attached chat-review-attached" role="group" aria-label="Review attached" data-round={round.id}>
      <span className="chat-with-what">
        <span>Your review goes with your next prompt</span>
        <span className="chat-board-chip chat-review-chip num">{reviewName(round, marks)}</span>
      </span>
      <button type="button" className="button button-quiet" title="Send the marks as ordinary ones, with what you said of each, and leave the review unsent" onClick={() => reviewActions.plain(round.id)}>
        Remove
      </button>
    </div>
  )
}

/** The drafts that go with the next prompt: those of a round that was not sent are held until Send review, and are not among them. */
export function goingNext(marks: readonly Mark[], rounds: RoundsView | undefined): Mark[] {
  return marks.filter((mark) => mark.status === 'draft' && !(rounds !== undefined && isHeld(mark, rounds)))
}

/** The chip while a round is being sent (`sending`, which main keeps until the prompt that carries it is delivered); nothing otherwise. */
export function ReviewChip() {
  const sending = useReview((s) => s.sending)
  const round = useReview((s) => (s.sending === null ? undefined : s.rounds.find((one) => one.id === s.sending)))
  const marks = useStore((s) => s.marks)
  if (sending === null || round === undefined) return null
  return <ReviewChipView round={round} marks={marks} />
}
