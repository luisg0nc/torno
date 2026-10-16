import { useMemo } from 'react'
import { AGENT_LABEL } from '../../../shared/agents'
import { type DraftSummary, draftSummary, useOnboard } from '../../state/onboard'
import { numbered } from '../numbered'

/** The session pane while a new object is made: what Claude Code will start with once it is created. */
export function DraftPane({ summary }: { summary: DraftSummary }) {
  const given = summary.given.map(([n, word]) => `${n} ${word}`).join(', ')
  return (
    <div className="draft-pane" role="note">
      <p className="draft-pane-lead">{AGENT_LABEL} starts here once you create the object.</p>
      <p>It works in the new folder with what you give it:</p>
      <ul>
        <li>
          Name: {summary.name === null ? <span className="draft-pane-none">No name yet</span> : <span className="num">{summary.name}</span>}
        </li>
        <li>What it is: {summary.described ? 'Said' : <span className="draft-pane-none">Not said yet</span>}</li>
        <li>What you have: {given === '' ? <span className="draft-pane-none">Nothing yet</span> : numbered(given)}</li>
      </ul>
    </div>
  )
}

/** The same, of the draft being made. */
export function DraftPaneLive() {
  const draft = useOnboard((s) => s.draft)
  const summary = useMemo(() => draftSummary(draft), [draft])
  return <DraftPane summary={summary} />
}
