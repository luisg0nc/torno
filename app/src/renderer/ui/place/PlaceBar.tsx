import { placeWords } from '../view/bandKind'
import { placeTagWords, placingActions, usePlacing } from '../../state/placing'
import { useShelf } from '../../state/shelf'
import { askNow } from '../shelf/placeRequest'
import { Band, BandButton, useBand } from '../view/Band'
import { Tag } from '../view/Tag'

/**
 * The band while a part of the shelf is being placed (#353): `Placing ec11 from the shelf, 1 placed`, with "Ask Claude" (placing ends and the
 * message box has the keys; what it holds is not sent) and "Stop". The request in the box is made as each mark is (`ui/shelf/placeRequest.ts`).
 */
export function PlaceBar() {
  const here = useBand() === 'place'
  const placing = usePlacing((s) => s.placing)
  if (!here || !placing) return null
  const words = placeWords(placing.part, placing.marks.length)
  return (
    <Band kind="place" label="Placing a part from the shelf" part="place-band">
      <svg className="band-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1.75 13.25h12.5" />
        <rect x="2.75" y="7.25" width="4" height="6" rx=".6" />
        <circle cx="10.5" cy="10.25" r="3" />
        <path d="M4.75 7.25V4.5" />
      </svg>
      <span>
        {words.lead}
        <span className="num">{words.part}</span>
        {words.mid}
        <span className="num" data-part="placed">
          {placing.marks.length}
        </span>{' '}
        placed
      </span>
      <BandButton primary data-part="place-ask" title="Put the request in the message box and stop placing; nothing is sent" onClick={() => askNow()}>
        Ask Claude
      </BandButton>
      <BandButton data-part="place-stop" onClick={() => placingActions.stop()}>
        Stop
      </BandButton>
    </Band>
  )
}

/**
 * The tag at the mark just left by a drop: which part is on the face, and what it cuts and keeps clear, in the kernel's numbers.
 * It stands until the pointer moves away (`placeTool`), and takes no pointer.
 */
export function PlaceTag() {
  const tag = usePlacing((s) => s.tag)
  const part = useShelf((s) => s.parts.find((p) => p.id === tag?.part))
  if (!tag || !part) return null
  const words = placeTagWords(part)
  return (
    <Tag id="place" subject={tag.at} prefer="left" status>
      <span className="place-tag" data-part="place-tag">
        <span className="place-tag-head">
          <span className="num">{tag.part}</span> on the face, <span className="num">{tag.mark}</span>
        </span>
        {(words.cuts !== null || words.keeps !== null) && (
          <span className="place-tag-says">
            {[words.cuts, words.keeps].filter((w) => w !== null).join(', ')}
          </span>
        )}
      </span>
    </Tag>
  )
}
