import { memo } from 'react'
import { saveParts, type SaveRun } from './historyJoin'

/**
 * What the person did to the project between two prompts, in one quiet line: their saves in their own editor, or the
 * Params they tried, with the build it made (several in a row are one line, with a count). Said from the history's own
 * `cause`, never worked out from times here. A build that failed is told so.
 */
export const SaveLine = memo(function SaveLine({ run }: { run: SaveRun }) {
  const failed = run.entries.some((e) => e.failed)
  return (
    <p className="chat-item chat-save" data-kind="save" data-cause={run.cause}>
      {saveParts(run).map((piece, n) =>
        piece.mono ? (
          <span key={n} className="num">
            {piece.text}
          </span>
        ) : (
          piece.text
        )
      )}
      {failed && <span data-verdict="failed"> · build failed</span>}
    </p>
  )
})
