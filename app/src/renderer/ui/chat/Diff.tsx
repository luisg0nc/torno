import { numbered } from '../numbered'
import type { DiffRow, Hunk } from './lineDiff'

const SIGN: Record<DiffRow['kind'], string> = { same: '', removed: '−', added: '+', gap: '' }

function Row({ row, numbers }: { row: DiffRow; numbers: boolean }) {
  if (row.kind === 'gap') return (
      <div className="diff-row" data-kind="gap" data-numbered={numbers ? '' : undefined}>
        <span>{numbered(row.text)}</span>
      </div>
    )
  // The sign and the strike carry the meaning; the wash behind a line only groups.
  const line = row.kind === 'removed' ? <del>{row.text}</del> : row.kind === 'added' ? <ins>{row.text}</ins> : <span>{row.text}</span>
  return (
    <div className="diff-row" data-kind={row.kind}>
      {numbers && (
        <span className="diff-line num" aria-hidden="true">
          {row.line}
        </span>
      )}
      <span className="diff-sign" aria-hidden="true">
        {SIGN[row.kind]}
      </span>
      {line}
    </div>
  )
}

/**
 * An edit of a file as lines removed (struck through, with a "−") and added (with a "+"), one block for each edit.
 * Text only, in the monospace face. Neither red nor green: those belong to marks and verdicts. `ofEdit` false: the hunks
 * are of a whole file (the sheet "See changes"), which the caption on an edit's lines would not be true of. `numbers`: the rows carry
 * their line numbers (`diffText(…, true)`), set in a column of their own.
 */
export function Diff({ hunks, ofEdit = true, numbers = false }: { hunks: Hunk[]; ofEdit?: boolean; numbers?: boolean }) {
  return (
    <div className="diff selectable">
      {hunks.map((hunk, n) => (
        <div key={n} className="diff-hunk">
          {hunk.title !== undefined && <p className="diff-title">{numbered(hunk.title)}</p>}
          {hunk.tooLong && <p className="diff-note">Too long to compare: every line of the old text is shown removed, every line of the new text added</p>}
          {hunk.everywhere && <p className="diff-note">Replaces every match in the file, of which one is shown</p>}
          {hunk.same && <p className="diff-note">No change</p>}
          {hunk.rows.length > 0 && (
            <div className="diff-rows">
              {hunk.rows.map((row, at) => (
                <Row key={at} row={row} numbers={numbers} />
              ))}
            </div>
          )}
        </div>
      ))}
      {ofEdit && <p className="diff-note diff-caption">Lines of the edit, not of the file: where it lands is not shown</p>}
    </div>
  )
}
