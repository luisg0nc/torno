import { useState, type ReactNode } from 'react'
import type { Mark } from '../../shared/marks'

/**
 * The marks the agent resolved and the person has not yet said they have seen, as one line: how many, "Review"
 * to open each with what the agent did (its row, with OK and Reopen), and "OK all" to acknowledge them all at
 * once. It has no key: a key that acknowledged many marks unseen would be too easy to press.
 */
export function ResolvedSummary({ marks, row, acknowledgeAll }: { marks: Mark[]; row: (mark: Mark) => ReactNode; acknowledgeAll: () => void }) {
  const [open, setOpen] = useState(false)
  const n = marks.length
  return (
    <div className="marks-review">
      <p>
        The agent resolved <span className="num">{n}</span> {n === 1 ? 'mark' : 'marks'}.{' '}
        <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Review'}
        </button>{' '}
        <button type="button" className="button" title="Seen: move them all to the resolved marks" onClick={acknowledgeAll}>
          OK all
        </button>
      </p>
      {open && (
        <ul className="mark-rows" aria-label="To review">
          {marks.map(row)}
        </ul>
      )}
    </div>
  )
}
