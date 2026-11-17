import { hint } from '../../shared/keys'
import { INTENT_CHIP, type Round, openRound, roundCounts } from '../../shared/reviews'
import { reviewActions, useReview } from '../state/review'
import { useStore } from '../state/store'

/** Where a round stands, in a few words: it is open, it was ended and has not gone, it is going, it went, or its marks were let go as plain ones. */
export function roundState(round: Round, sending: string | null): string {
  if (round.sentAt !== undefined) return 'sent'
  if (round.plain !== undefined) return 'sent as plain marks'
  if (sending === round.id) return 'sending'
  return round.endedAt === undefined ? 'open' : 'ended, not sent'
}

/**
 * The reviews at the head of the Marks list, outside its scroll: "Review this build" while no round is open (the key of
 * `marks.review` beside it), and a row for each round, the newest first, with `Review of h41 · 3 − · 2 +` as the round
 * names itself, where it stands and the way to its panel. What main said when it would not start one is said under them.
 */
export function ReviewSummary() {
  const rounds = useReview((s) => s.rounds)
  const sending = useReview((s) => s.sending)
  const refused = useReview((s) => s.refused)
  const marks = useStore((s) => s.marks)
  const layout = useStore((s) => s.layout)
  const open = openRound(rounds)
  return (
    <div className="review-summary" data-part="review-summary">
      {open === undefined && (
        <button type="button" className="bar-button review-start" aria-keyshortcuts={hint('marks.review')} title={`Start a round on the build on show: mark what you don't want and what you want, then send it at once (${hint('marks.review')})`} onClick={() => void reviewActions.start(layout)}>
          Review this build
        </button>
      )}
      {rounds.length > 0 && (
        <ul className="mark-rows" aria-label="Reviews">
          {[...rounds].reverse().map((round) => {
            const { dont, want } = roundCounts(marks, round.id)
            return (
              <li key={round.id} className="round-row" data-round={round.id} data-state={roundState(round, sending)}>
                <span className="mark-chip num" data-author="user">{round.id}</span>
                <span className="round-name">
                  Review of <span className="num">{round.build}</span>
                  {dont > 0 && (
                    <>
                      {' · '}
                      <span className="num">{`${dont} ${INTENT_CHIP.dont}`}</span>
                    </>
                  )}
                  {want > 0 && (
                    <>
                      {' · '}
                      <span className="num">{`${want} ${INTENT_CHIP.want}`}</span>
                    </>
                  )}
                </span>
                <span className="round-state">{roundState(round, sending)}</span>
                <button type="button" className="link-button" aria-label={`Open the panel of ${round.id}`} title="The items of the round, and what Claude did with each" onClick={() => reviewActions.openPanel(round.id)}>
                  Open
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {refused !== null && (
        <p className="marks-problem selectable" role="alert">
          {refused}
        </p>
      )}
    </div>
  )
}
