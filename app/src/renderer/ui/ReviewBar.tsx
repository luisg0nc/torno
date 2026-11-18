import { useEffect } from 'react'
import { hint, pressed } from '../../shared/keys'
import type { ReviewIntent } from '../../shared/marks'
import { INTENT_CHIP, roundCounts } from '../../shared/reviews'
import { boardStore } from '../state/board'
import { openRoundNow, reviewActions, useReview } from '../state/review'
import { store, useStore } from '../state/store'
import { TYPING } from './typing'
import { Band, BandButton, useBand } from './view/Band'

/** The three ways the next marks can be, in the order of the bar: the choice, what it says, and the key of each that has one. */
const CHOICES: Array<{ choice: 'plain' | ReviewIntent; label: string; sign?: string; shortcut?: 'review.dont' | 'review.want'; title: string }> = [
  { choice: 'plain', label: 'Plain', title: 'The marks you make go to Claude as marks, in the round, with no word on them' },
  { choice: 'dont', label: "Don't want", sign: INTENT_CHIP.dont, shortcut: 'review.dont', title: "The marks you make are what you don't want: drawn hatched, in your colour" },
  { choice: 'want', label: 'Want', sign: INTENT_CHIP.want, shortcut: 'review.want', title: 'The marks you make are what you want: drawn solid, in your colour' }
]

/**
 * The keys of a review, heard outside a field and the terminal with a project on show: `marks.review` starts a round on
 * the build on show (or finds the one that is open), and the two intent keys choose what the next marks are, the key of
 * the one chosen taking it back to plain. They are the window's; the choice is nothing main keeps.
 */
export function useReviewKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const s = store.getState()
      // Only with the model on show: the page of projects, the page of a new one, the board and a tracing have keys of their own.
      if (s.page !== 'object' || s.objectId === null || boardStore.getState().shown !== 'model') return
      if (pressed(e, 'marks.review')) {
        e.preventDefault()
        void reviewActions.start(s.layout)
        return
      }
      const open = openRoundNow()
      if (!open || open.layout !== s.layout) return
      const intent = pressed(e, 'review.dont') ? 'dont' : pressed(e, 'review.want') ? 'want' : null
      if (intent === null) return
      e.preventDefault()
      reviewActions.toggle(intent)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * The band of a review, at the top left of the view while a round is open (Review-A): which build is reviewed, whether the marks
 * you make next are plain, what you don't want or what you want (the pens, each a pill with a round sign), how many of each the
 * round has, Items, End (the round stays, unsent, with its marks held) and Send review (the round goes with your next prompt).
 * Any mark tool works while it is open; the mark gets the choice and joins the round. Marks keep their author's colour: the
 * signs are set in the face of numbers, and what is not wanted is hatched. The choice is not for a measure or a "should be here"
 * (the Measure and Should be here tools of a tracing, whose sheet takes the place of this band): they are about a number or a
 * layer, not the model, so `withIntent` leaves them as they are and they never join a round. A mode above it in the order of
 * `bandOf` (a line-up, a face to pick) takes the place; a sketch opened inside it does not.
 */
export function ReviewBar() {
  useReviewKeys()
  const band = useBand()
  const round = useReview((s) => openRoundNow(s))
  const choice = useReview((s) => s.choice)
  const refused = useReview((s) => s.refused)
  const marks = useStore((s) => s.marks)
  const layout = useStore((s) => s.layout)
  if (!round || band !== 'review') return null
  const { dont, want, plain } = roundCounts(marks, round.id)
  const here = round.layout === layout
  return (
    <>
      <Band kind="review" label="Review" part="review">
        <span className="reviewbar-label">
          Reviewing <span className="num">{round.build}</span>
        </span>
        {!here && (
          <span className="reviewbar-where" title="A mark made in another layout does not join the round">
            of the layout <span className="num">{round.layout}</span>
          </span>
        )}
        <div className="reviewbar-pens" role="radiogroup" aria-label="New marks are">
          {CHOICES.map((c) => (
            <button key={c.choice} type="button" className="band-pen" role="radio" aria-checked={here && choice === c.choice} aria-pressed={here && choice === c.choice} disabled={!here} aria-keyshortcuts={c.shortcut ? hint(c.shortcut) : undefined} title={`${c.title}${c.shortcut ? ` (${hint(c.shortcut)})` : ''}`} onClick={() => reviewActions.choose(c.choice)}>
              {c.sign && (
                <span className="sign-disc num" data-sign={c.choice}>
                  {c.sign}
                </span>
              )}{' '}
              {c.label}
            </button>
          ))}
        </div>
        <span className="reviewbar-counts num" title="What the round has: marks you don't want, marks you want, and plain ones">
          {`${dont} ${INTENT_CHIP.dont} · ${want} ${INTENT_CHIP.want}${plain > 0 ? ` · ${plain} plain` : ''}`}
        </span>
        <BandButton aria-label={`Open the panel of ${round.id}`} title="The items of the round, one by one" onClick={() => reviewActions.openPanel(round.id)}>
          Items
        </BandButton>
        <BandButton title="End the round without sending it: its marks stay drafts, held, and it can be opened again from its panel" onClick={() => void reviewActions.end(round.id)}>
          End
        </BandButton>
        <BandButton primary className="reviewbar-send" disabled={dont + want + plain === 0} title="Send the round: its marks go to Claude with your next prompt, with one line that says they are a review" onClick={() => void reviewActions.send(round.id)}>
          Send review
        </BandButton>
      </Band>
      {refused !== null && (
        <p className="band-note selectable" role="alert">
          {refused}
        </p>
      )}
    </>
  )
}
