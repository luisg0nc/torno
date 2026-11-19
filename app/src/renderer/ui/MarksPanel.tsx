import { useEffect, useState } from 'react'
import { type Mark, markEndParts } from '../../shared/marks'
import { actions, useStore } from '../state/store'
import { AskToCommit } from './AskToCommit'
import { groupMarks, splitMarkGroups } from './markGroups'
import { useMarkRows } from './markRows'
import { done, offerUndo, useRowsSaid } from './rowsSaid'
import { ReviewSummary } from './ReviewSummary'

/**
 * The marks of the open object, grouped by who acts next (`splitMarkGroups`): to send (the person's, with their next prompt), with
 * the agent, then, folded away, the resolved ones. What waits on the person (the marks the agent resolved or left for them, and
 * the checks that fail) is in Needs you. At its head, outside its scroll, are Review this build and a row for each round. Marks of
 * every layout are listed; one of a layout that is not shown says which, and going to it switches there.
 */
export function MarksPanel() {
  const objectId = useStore((s) => s.objectId)
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const problem = useStore((s) => s.marksProblem)
  const onPart = useStore((s) => s.marksOnPart)
  const [showResolved, setShowResolved] = useState(false)
  const row = useMarkRows('marks')
  // What main said when it refused a change, until the next one goes through, and the mark just deleted, which can be put back.
  const refused = useRowsSaid((s) => (s.refused?.where === 'marks' ? s.refused.message : null))
  const undo = useRowsSaid((s) => (s.undo?.where === 'marks' ? s.undo.id : null))

  useEffect(() => setShowResolved(false), [objectId])

  if (!objectId) return null

  // Cut to one part by a click on its count in the layers: a view of the list only, the agent is told every mark.
  const listed = onPart === null ? marks : marks.filter((m) => m.kind !== 'region' && markEndParts(m).includes(onPart))
  const groups = groupMarks(listed, revision)
  const { needs, marks: mine } = splitMarkGroups(groups)
  const { toSend, withAgent, resolved } = mine
  /** A group of the list under its heading, when it has marks. */
  const group = (name: string, of: Mark[], hint?: string) =>
    of.length > 0 && (
      <>
        <h3 className="marks-group">
          {name} <span className="num">{of.length}</span>
          {hint && ` · ${hint}`}
        </h3>
        <ul className="mark-rows" aria-label={name}>
          {of.map((m) => row(m))}
        </ul>
      </>
    )

  return (
    <div className="section marks">
      {problem !== null && (
        <p className="marks-problem selectable" role="status">
          {problem}{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              actions.dismissMarksProblem()
              void window.torno.marks.dismissProblem(objectId).catch(() => {})
            }}
          >
            Dismiss
          </button>
        </p>
      )}
      {refused !== null && (
        <p className="marks-problem selectable" role="alert">
          {refused}
        </p>
      )}
      {/* And the reviews: starting one, and a row for each round. */}
      <ReviewSummary />
      {onPart !== null && (
        <p className="marks-filter" data-part="marks-filter">
          Only marks on <span className="num">{onPart}</span>
          <button type="button" className="icon-button" aria-label="Show all marks" title="Show all marks" onClick={() => actions.listMarksOnPart(null)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
              <path d="m4.5 4.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </p>
      )}
      <div className="marks-body">
        {undo !== null && (
          <p className="marks-undo" role="status">
            Deleted <span className="num">{undo}</span> ·{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                const id = undo
                offerUndo('marks', null)
                done('marks', window.torno.marks.restore(objectId, id))
              }}
            >
              Undo
            </button>
          </p>
        )}
        {marks.length > 0 && listed.length === 0 && <p className="section-note">No marks on <span className="num">{onPart}</span>.</p>}
        {marks.length === 0 && (
          <div className="marks-empty">
            <p>Point at the part to leave a note for the agent.</p>
            <p>A mark goes with your next prompt, and stays here until the agent resolves it.</p>
          </div>
        )}
        {listed.length > 0 && groups.checks.length + needs.fromAgent.length + toSend.length + withAgent.length === 0 && (
          <p className="section-note">{needs.toReview.length > 0 ? 'What is left waits for you at the top of the card.' : 'Every mark is resolved.'}</p>
        )}
        {group('From the agent', needs.fromAgent, 'read or answer')}
        {group('To send', toSend, 'with your next prompt')}
        {group('With the agent', withAgent)}
        <AskToCommit />
        {resolved.length > 0 && (
          <>
            <button type="button" className="marks-fold" aria-expanded={showResolved} onClick={() => setShowResolved((shown) => !shown)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 4 4 4-4 4" />
              </svg>
              Resolved
              <span className="num">{resolved.length}</span>
            </button>
            {showResolved && (
              <ul className="mark-rows" aria-label="Resolved marks">
                {resolved.map((m) => row(m))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
