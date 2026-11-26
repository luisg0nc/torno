import { Fragment } from 'react'
import type { ShelfPart } from '../../../shared/shelf'
import { drawingOf, holeParts, ruleKinds, rulesTitle } from '../../state/shelf'

// The pieces of a part's row that the Shelf tab (`ui/card/ShelfPanel.tsx`) and the chat's slip of a shelf file (`ui/chat/ShelfSlip.tsx`) both draw: its
// picture at the shelf's one scale, what it cuts, and the rules that say how sure its sizes are.

/** The part's side outline in its well, at the shelf's scale; the well is empty for a part with no body. */
export function PartPicture({ part }: { part: ShelfPart }) {
  const drawing = drawingOf(part)
  return (
    <span className="shelf-pic">
      {drawing && (
        <svg className="shelf-draw" width={drawing.width} height={drawing.height} viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-hidden="true">
          <path d={drawing.path} fillRule="evenodd" />
        </svg>
      )}
    </span>
  )
}

/** What the part cuts (`hole Ø7.2`) and its rules, as the line under its name; a part that did not build says so in the warning colour instead. */
export function PartLine({ part }: { part: ShelfPart }) {
  const hole = holeParts(part)
  const kinds = ruleKinds(part)
  return (
    <span className="shelf-line">
      {part.error ? (
        <span className="shelf-broken">does not build</span>
      ) : (
        <>
          {hole.length > 0 && (
            <span className="shelf-hole">
              {hole.map((piece, n) => (
                <Fragment key={n}>{n % 2 === 1 ? <span className="num">{piece}</span> : piece}</Fragment>
              ))}
            </span>
          )}
          {kinds.length > 0 && (
            <span className="shelf-rules" title={rulesTitle(part)}>
              {kinds.map((kind, n) => (
                <i key={n} className={`r-${kind}`} />
              ))}
            </span>
          )}
        </>
      )}
    </span>
  )
}
