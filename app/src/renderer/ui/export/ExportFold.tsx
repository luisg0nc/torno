import { AGENT_LABEL } from '../../../shared/agents'
import { actions, useStore } from '../../state/store'
import { usePreview } from '../../state/exportPreview'
import { foldWords, marksToReview } from './exportWords'

/**
 * The conversation folded to a 40 px band at the dock's foot while the export is open (spec 2026-11-18, "Export, on the bench"):
 * how the session stands and what waits in the marks, and the way back. An ask that arrives turns it `--warn-wash` and says it needs you,
 * with Answer: both put the export away, and the dock shows the conversation with the ask in it.
 */
export function ExportFold() {
  const status = useStore((s) => (s.objectId === null ? undefined : s.sessions[s.objectId]?.status))
  const toReview = useStore((s) => marksToReview(s.marks))
  const saving = usePreview((s) => s.preview?.saving === true)
  const words = foldWords(status, toReview)
  const asks = status === 'needs_input'
  return (
    <div className="export-fold" data-asks={asks ? '' : undefined} role="status" data-part="export-fold">
      <span className="status-dot" aria-hidden="true" />
      <b>{AGENT_LABEL}</b>
      <span>{words.marks === null ? words.state : `${words.state}, ${words.marks}`}</span>
      <span className="spacer" />
      <button type="button" className="button button-quiet" data-primary={asks ? '' : undefined} disabled={saving} onClick={() => actions.exportSheet(null)}>
        {asks ? 'Answer' : 'Back to the chat'}
      </button>
    </div>
  )
}
