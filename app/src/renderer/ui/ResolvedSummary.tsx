import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Mark } from '../../shared/marks'
import { actions } from '../state/store'
import type { ReviewOutcome, ReviewStep } from './reviewStep'
import { sayReviewed, useRowsSaid } from './rowsSaid'

interface Walk {
  /** The marks to review, as they were when "Review" was pressed. */
  order: string[]
  at: number
  ok: number
  reopened: number
  skipped: number
}

const said = ({ order, ok, reopened, skipped }: Walk): string =>
  `Reviewed ${order.length}: ${ok} OK${reopened > 0 ? `, ${reopened} reopened` : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}`

/**
 * The marks the agent resolved and the person has not yet said they have seen, in Marks, under From the agent: a row for each (what the agent
 * did, and OK and Reopen… on it), and over them one line: how many, "Review" to walk them one at a time (the mark is made the
 * active one and the camera goes to its view, its row has Skip too), and "OK all" to acknowledge them all at once. When the
 * walk is done the line says how it went, for a few seconds. It has no key: a key that acknowledged many marks
 * unseen would be too easy to press.
 */
export function ResolvedSummary({ marks, row, acknowledgeAll }: { marks: Mark[]; row: (mark: Mark, extra?: { review?: ReviewStep; source?: string }) => ReactNode; acknowledgeAll: () => void }) {
  const [walk, setWalk] = useState<Walk | null>(null)
  // How the last walk went: held outside, so that it stays up when the last mark is judged and Needs you has nothing else to say.
  const closing = useRowsSaid((s) => s.reviewed)
  // The walk as the handlers of a row last saw it: they may run after a render the state has not reached.
  const current = useRef<Walk | null>(null)
  const go = (next: Walk | null): void => {
    current.current = next
    setWalk(next)
  }
  const finish = (done: Walk): void => {
    go(null)
    sayReviewed(said(done))
  }

  const start = (): void => {
    sayReviewed(null)
    go({ order: marks.map((m) => m.id), at: 0, ok: 0, reopened: 0, skipped: 0 })
    actions.focusMark(marks[0].id)
  }
  const step = (outcome: ReviewOutcome): void => {
    const was = current.current
    if (!was) return
    const next = { ...was, at: was.at + 1, ok: was.ok + (outcome === 'ok' ? 1 : 0), reopened: was.reopened + (outcome === 'reopened' ? 1 : 0), skipped: was.skipped + (outcome === 'skipped' ? 1 : 0) }
    if (next.at >= next.order.length) return finish(next)
    go(next)
    actions.focusMark(next.order[next.at])
  }

  const mark = walk ? marks.find((m) => m.id === walk.order[walk.at]) : undefined
  // A mark of the walk that was dealt with some other way ("OK all", the agent's tool): on to the next.
  useEffect(() => {
    if (!walk || mark) return
    // Only once the step that dealt with it has been counted: it moves the walk on itself.
    const timer = setTimeout(() => {
      const was = current.current
      if (!was || marks.some((m) => m.id === was.order[was.at])) return
      if (marks.length === 0 || was.at + 1 >= was.order.length) finish({ ...was, at: was.order.length })
      else {
        go({ ...was, at: was.at + 1 })
        actions.focusMark(was.order[was.at + 1])
      }
    }, 300)
    return () => clearTimeout(timer)
  })

  const n = marks.length
  if (n === 0 && !walk && closing === null) return null
  return (
    <div className="needs-review">
      {walk ? (
        <p>
          Reviewing <span className="num">{walk.at + 1}</span> of <span className="num">{walk.order.length}</span> · <span className="num">{walk.order[walk.at]}</span>{' '}
          <button type="button" className="link-button" onClick={() => go(null)}>
            Stop
          </button>
        </p>
      ) : (
        n > 0 && (
          <p>
            The agent resolved <span className="num">{n}</span> {n === 1 ? 'mark' : 'marks'}.{' '}
            <button type="button" className="link-button" onClick={start}>
              Review
            </button>{' '}
            <button type="button" className="button" title="Seen: move them all to the resolved marks" onClick={acknowledgeAll}>
              OK all
            </button>
          </p>
        )
      )}
      {!walk && closing !== null && <p className="needs-review-done">{closing}</p>}
      {n > 0 && (
        <ul className="mark-rows" aria-label="To review">
          {marks.map((m) => row(m, { review: walk && m.id === mark?.id ? { step } : undefined, source: 'to review' }))}
        </ul>
      )}
    </div>
  )
}
