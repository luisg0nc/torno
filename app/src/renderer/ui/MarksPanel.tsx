import { useEffect, useState } from 'react'
import { type Mark, type MarkPatch, markAnchors } from '../../shared/marks'
import { actions, layerOf, useStore } from '../state/store'
import { MarkRow } from './MarkRow'
import { groupMarks } from './markGroups'
import { ResolvedSummary } from './ResolvedSummary'

/**
 * The marks of the open object, below the layers, grouped by what is to be
 * done with them (`groupMarks`): to send, with the agent, to review, then,
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
  const [showResolved, setShowResolved] = useState(false)
  // What main said when it refused a change, until the next one goes through.
  const [refused, setRefused] = useState<string | null>(null)

  useEffect(() => {
    setRefused(null)
    setShowResolved(false)
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
  const row = (mark: (typeof marks)[number]) => (
    <MarkRow
      key={mark.id}
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
      remove={() => done(window.torno.marks.remove(objectId, mark.id))}
    />
  )
  const { toSend, withAgent, toReview, resolved } = groupMarks(marks)
  /** A group of the list under its heading, when it has marks. */
  const group = (name: string, of: Mark[]) =>
    of.length > 0 && (
      <>
        <h3 className="marks-group">
          {name} <span className="num">{of.length}</span>
        </h3>
        <ul className="mark-rows" aria-label={name}>
          {of.map(row)}
        </ul>
      </>
    )

  return (
    <section className="section marks" aria-label="Marks">
      <h2 className="section-title">Marks</h2>
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
      <div className="marks-body">
        {marks.length === 0 && (
          <div className="marks-empty">
            <p>Point at the part to leave a note for the agent.</p>
            <p>A mark goes with your next prompt, and stays here until the agent resolves it.</p>
          </div>
        )}
        {marks.length > 0 && toSend.length + withAgent.length + toReview.length === 0 && <p className="section-note">Every mark is resolved.</p>}
        {group('To send', toSend)}
        {group('With the agent', withAgent)}
        {toReview.length > 0 && (
          <>
            <h3 className="marks-group">
              To review <span className="num">{toReview.length}</span>
            </h3>
            <ResolvedSummary key={objectId} marks={toReview} row={row} acknowledgeAll={() => done(window.torno.marks.acknowledge(objectId, toReview.map((m) => m.id)))} />
          </>
        )}
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
                {resolved.map(row)}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  )
}
