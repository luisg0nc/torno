import { useEffect, useRef, useState } from 'react'
import { type Mark, type MarkPatch, markAnchors, markEndParts } from '../../shared/marks'
import { actions, layerOf, useStore } from '../state/store'
import { AskToCommit } from './AskToCommit'
import { MarkRow } from './MarkRow'
import { groupMarks } from './markGroups'
import { type ReviewStep, ResolvedSummary } from './ResolvedSummary'
import { ReviewSummary } from './ReviewSummary'

/** How long "Undo" is offered after a delete. */
const UNDO_MS = 10_000

/**
 * The marks of the open object, below the layers, grouped by what is to be
 * done with them (`groupMarks`): checks (dimensions with something expected of them), to send, from the agent, to review, with the agent, then,
 * folded away, the resolved ones. A mark the agent resolved is to review
 * until the person has said they have seen it, or reopened it. Marks of every layout are listed; one of a layout that is not shown
 * says which, and going to it switches there.
 */
export function MarksPanel() {
  const objectId = useStore((s) => s.objectId)
  const marks = useStore((s) => s.marks)
  const layout = useStore((s) => s.layout)
  const layouts = useStore((s) => s.scene?.layouts)
  const parts = useStore((s) => s.scene?.parts)
  const layers = useStore((s) => s.layers)
  const scanViews = useStore((s) => s.scanViews)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const active = useStore((s) => s.activeMark)
  const problem = useStore((s) => s.marksProblem)
  const onPart = useStore((s) => s.marksOnPart)
  const [showResolved, setShowResolved] = useState(false)
  // What main said when it refused a change, until the next one goes through.
  const [refused, setRefused] = useState<string | null>(null)

  // The mark just deleted, which can be put back for ten seconds, or until the next delete.
  const [undo, setUndo] = useState<string | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const offerUndo = (id: string | null): void => {
    clearTimeout(undoTimer.current)
    setUndo(id)
    if (id !== null) undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
  }
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  useEffect(() => {
    setRefused(null)
    setShowResolved(false)
    offerUndo(null)
  }, [objectId])

  if (!objectId) return null

  const done = (call: Promise<unknown>): void => {
    call.then(
      () => setRefused(null),
      (e: unknown) => setRefused(e instanceof Error ? e.message : String(e))
    )
  }
  /** Whether a mark is on a part that is there and switched off: it is not drawn, like its part. A dimension, when that is so of both its ends. */
  const hidden = (mark: (typeof marks)[number]): boolean => {
    if (mark.status === 'resolved') return false
    // A region is drawn on its scan, and not while that is switched off.
    if (mark.kind === 'region') return mark.anchorState !== 'orphaned' && scanViews[mark.scan]?.visible === false
    const off = (part: string | undefined): boolean => part !== undefined && layerOf(layers, part)?.visible === false && (parts?.some((p) => p.layout === mark.layout && p.name === part) ?? false)
    const ends = mark.kind === 'dimension' ? markAnchors(mark) : markAnchors(mark).slice(0, 1)
    return ends.length > 0 && ends.every((anchor) => off(anchor.part))
  }
  const row = (mark: (typeof marks)[number], review?: ReviewStep) => (
    <MarkRow
      key={mark.id}
      review={review}
      mark={mark}
      active={mark.id === active}
      // A region is of its scan in every layout: it is never elsewhere, and its layout going takes nothing from it.
      elsewhere={mark.kind !== 'region' && mark.layout !== layout}
      gone={mark.kind !== 'region' && layouts !== undefined && !layouts.includes(mark.layout)}
      partHidden={hidden(mark)}
      revision={revision}
      change={(patch: MarkPatch) => {
        const call = window.torno.marks.update(objectId, mark.id, patch)
        done(call)
        return call
      }}
      remove={() => {
        const call = window.torno.marks.remove(objectId, mark.id)
        done(call)
        void call.then(() => offerUndo(mark.id), () => {})
      }}
    />
  )
  // Cut to one part by a click on its count in the layers: a view of the list only, the agent is told every mark.
  const listed = onPart === null ? marks : marks.filter((m) => m.kind !== 'region' && markEndParts(m).includes(onPart))
  const { checks, toSend, fromAgent, withAgent, toReview, resolved } = groupMarks(listed, revision)
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
                offerUndo(null)
                done(window.torno.marks.restore(objectId, id))
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
        {listed.length > 0 && checks.length + toSend.length + fromAgent.length + withAgent.length + toReview.length === 0 && <p className="section-note">Every mark is resolved.</p>}
        {group('Checks', checks)}
        {group('To send', toSend, 'with your next prompt')}
        {group('From the agent', fromAgent)}
        {toReview.length > 0 && (
          <h3 className="marks-group">
            To review <span className="num">{toReview.length}</span>
          </h3>
        )}
        <ResolvedSummary key={objectId} marks={toReview} row={row} acknowledgeAll={() => done(window.torno.marks.acknowledge(objectId, toReview.map((m) => m.id)))} />
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
