import { useEffect, useState } from 'react'
import type { HistoryEntry } from '../../../shared/history'
import type { Mark } from '../../../shared/marks'
import { type Round, openRound, reviewName } from '../../../shared/reviews'
import { reviewActions, useReview } from '../../state/review'
import { actions, store, useStore } from '../../state/store'
import { roundState } from '../ReviewSummary'
import { SignDisc } from '../SignDisc'
import { useHistory } from '../useHistory'
import { roundNumber, roundRows } from './rows'

/** The item whose Still wrong is being written, and the words so far. */
export interface Wrong {
  id: string
  note: string
}

interface PanelProps {
  round: Round
  rounds: readonly Round[]
  marks: readonly Mark[]
  /** The builds the history keeps, oldest first; undefined until it is read. */
  history: readonly HistoryEntry[] | undefined
  sending: string | null
  /** What main refused last, in its words. */
  refused: string | null
  wrong: Wrong | null
  onWrong: (wrong: Wrong | null) => void
}

/**
 * The follow-up of a round (Review-B), the head of the route card (`card/InHand.tsx`): each item with its chip, its note and what Claude said of it, OK and
 * Still wrong for an item Claude resolved (Still wrong may carry a note, and sends the item into the next round), what the
 * person made of the answer for those already judged, where the reviewed build is shown against the live one, and what can be
 * done with the round: start the next, open it again, or let it go as plain marks.
 */
export function RoundPanelView({ round, rounds, marks, history, sending, refused, wrong, onWrong }: PanelProps) {
  const { rows, compare } = roundRows(round, marks, history ?? [])
  const unsent = round.sentAt === undefined
  const open = openRound(rounds)
  const number = roundNumber(round, rounds)
  return (
    <section className="round-panel" aria-label={`Review ${round.id}`} data-part="round-panel" data-head="review" data-round={round.id}>
      <header className="round-panel-head">
        <h2 className="round-panel-title num">{reviewName(round, marks)}</h2>
        <span className="round-state">{roundState(round, sending)}</span>
        <button type="button" className="icon-button" aria-label="Close the review" title="Close the review" onClick={() => reviewActions.openPanel(null)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
            <path d="m4.5 4.5 7 7m0-7-7 7" />
          </svg>
        </button>
      </header>
      {unsent && round.plain === undefined && <p className="round-panel-goes">goes as one prompt</p>}
      {round.line !== '' && <p className="round-panel-line">{round.line}</p>}
      {history !== undefined && (
        <p className="round-panel-compare" data-compare={'off' in compare ? 'off' : 'on'}>
          {'off' in compare ? (
            <>Not shown beside the live build: {compare.off}.</>
          ) : (
            <>
              <span className="num">{compare.from}</span> is shown faint beside <span className="num">{compare.to}</span>.
            </>
          )}
        </p>
      )}
      <ul className="round-items" aria-label="Items of the review">
        {rows.map((row) => (
          <li key={row.id} className="round-item" data-mark={row.id} data-said={row.said || undefined}>
            <span className="round-item-sign">{row.intent !== undefined && <SignDisc intent={row.intent} title={row.intent === 'dont' ? "Don't want" : 'Want'} />}</span>
            <div className="round-item-body">
              <div className="round-item-main">
                <span className="mark-chip num" data-author="user">
                  {row.id}
                </span>
                {row.note !== '' && <span className="round-item-note selectable">{row.note}</span>}
              </div>
              {row.where !== '' && <span className="round-item-where num">{row.where}</span>}
              {row.resolved !== undefined && (
                <p className="round-item-answer selectable">
                  <span className="round-item-by">Claude</span> {row.resolved}
                </p>
              )}
              {row.said !== '' && <p className="round-item-said">{row.said}</p>}
              {row.can === 'judge' && wrong?.id !== row.id && (
                <div className="round-item-actions">
                  <button type="button" className="button button-quiet" title="You accept what Claude did" onClick={() => reviewActions.judge(row.id, 'ok')}>
                    OK
                  </button>
                  <button type="button" className="button button-quiet" title="It is not fixed: the item goes into the next round" onClick={() => onWrong({ id: row.id, note: '' })}>
                    Still wrong
                  </button>
                </div>
              )}
              {row.can === 'judge' && wrong?.id === row.id && (
                <div className="round-item-wrong">
                  <textarea
                    className="round-item-field"
                    rows={2}
                    aria-label={`What is still wrong with ${row.id}, if you would say`}
                    placeholder="What is still wrong (optional)"
                    value={wrong.note}
                    onChange={(e) => onWrong({ id: row.id, note: e.target.value })}
                  />
                  <div className="round-item-actions">
                    <button
                      type="button"
                      className="button"
                      title="The item goes into the next round with your note"
                      onClick={async () => {
                        const note = wrong.note.trim()
                        if (await reviewActions.judge(row.id, 'still-wrong', note === '' ? undefined : note)) onWrong(null)
                      }}
                    >
                      Send back
                    </button>
                    <button type="button" className="button button-quiet" onClick={() => onWrong(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="round-panel-line">Nothing is in this review.</p>}
      <div className="round-panel-foot">
        {unsent && round.endedAt === undefined && round.plain === undefined && <p className="round-panel-comment">Comment a stroke by clicking it</p>}
        {!unsent && open === undefined && (
          <button type="button" className="button" title="Opens the next review on the build on show, with the items you said are still wrong" onClick={() => reviewActions.carry(round.id)}>
            {`Start round ${number + 1}`}
          </button>
        )}
        {unsent && round.endedAt !== undefined && open === undefined && (
          <button type="button" className="button button-quiet" title="Opens the review again, to add marks to it or send it" onClick={() => reviewActions.reopen(round.id)}>
            Open again
          </button>
        )}
        {unsent && round.plain === undefined && sending !== round.id && rows.length > 0 && (
          <button type="button" className="button button-primary" title="Send the round: its marks go to Claude with your next prompt, with one line that says they are a review" onClick={() => void reviewActions.send(round.id)}>
            Send review
          </button>
        )}
        {unsent && round.plain === undefined && sending !== round.id && (
          <button type="button" className="button button-quiet" title="The marks go to Claude as ordinary ones with your next prompt, and the review is never sent" onClick={() => reviewActions.plain(round.id)}>
            Send as plain marks
          </button>
        )}
      </div>
      {refused !== null && (
        <p className="marks-problem selectable" role="alert">
          {refused}
        </p>
      )}
    </section>
  )
}

/**
 * The panel of the round `panel` names, while one does. With it up the reviewed build is shown faint beside the live one
 * (Compare), when the history keeps it; the comparing goes when the panel does, if it is still that one.
 */
export function RoundPanel() {
  const id = useReview((s) => s.panel)
  const rounds = useReview((s) => s.rounds)
  const sending = useReview((s) => s.sending)
  const refused = useReview((s) => s.refused)
  const marks = useStore((s) => s.marks)
  const round = id === null ? undefined : rounds.find((one) => one.id === id)
  const history = useHistory(round !== undefined)
  const [wrong, setWrong] = useState<Wrong | null>(null)
  const entries = history?.entries
  const compare = round !== undefined && entries !== undefined ? roundRows(round, marks, entries).compare : undefined
  const from = compare !== undefined && 'from' in compare ? compare.from : undefined
  const to = compare !== undefined && 'from' in compare ? compare.to : undefined
  useEffect(() => {
    if (from === undefined || to === undefined) return
    actions.compare(from, to)
    return () => {
      // Only the one this panel made: another comparing the person began meanwhile stays.
      if (store.getState().compare?.from === from) actions.endCompare()
    }
  }, [from, to])
  useEffect(() => setWrong(null), [id])
  if (round === undefined) return null
  return <RoundPanelView round={round} rounds={rounds} marks={marks} history={entries} sending={sending} refused={refused} wrong={wrong} onWrong={setWrong} />
}
