import { memo } from 'react'
import { boardActions } from '../../state/board'
import { useShelf } from '../../state/shelf'
import { PartLine, PartPicture } from '../shelf/PartBits'
import type { Slip } from './shelfSlip'

/**
 * The slip under the card of a write to a shelf part's folder (#354): "On the shelf: ec11" and the file written, and, once the shelf lists the part
 * (it is read again a moment after a file changes), its picture, name, what it cuts and its rules, with "Open it". A part that does not build says so in
 * the warning colour. Drawn from the slip and the shelf as the window has it; nothing of it is stored.
 */
export const ShelfSlip = memo(function ShelfSlip({ slip }: { slip: Slip }) {
  const part = useShelf((s) => s.parts.find((p) => p.id === slip.id))
  return (
    <div className="chat-item chat-shelf-slip" data-kind="shelf-slip" data-part={slip.id} role="group" aria-label={`The shelf's ${slip.id}`}>
      <p className="chat-shelf-slip-head">
        <span>On the shelf: </span>
        <b className="chat-shelf-slip-id num">{slip.id}</b>
        <span className="chat-shelf-slip-files num">{slip.files.join(', ')}</span>
      </p>
      {part && (
        <div className="chat-shelf-slip-body">
          <PartPicture part={part} />
          <span className="shelf-text">
            <b className="shelf-name">{part.name}</b>
            <PartLine part={part} />
          </span>
          <button type="button" className="button chat-shelf-slip-open" onClick={() => boardActions.openPart(slip.id)}>
            Open it
          </button>
        </div>
      )}
    </div>
  )
})
