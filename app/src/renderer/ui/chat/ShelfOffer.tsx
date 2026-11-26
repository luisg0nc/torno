import { numbered } from '../numbered'
import type { ShelfOffer as Offer } from './offerLines'

/**
 * What a question that offers a part to the shelf says besides its title (#354): its other lines as they were written, and the size lines as a
 * table, each a value in the face of numbers, what it is and where it comes from, in the warning colour when it is assumed. The answers are the
 * card's own buttons.
 */
export function ShelfOffer({ offer }: { offer: Offer }) {
  return (
    <div className="chat-offer-body selectable">
      {offer.blocks.map((block, n) =>
        block.kind === 'text' ? (
          <p key={n} className="chat-offer-note">
            {numbered(block.text)}
          </p>
        ) : (
          <dl key={n} className="chat-offer-sizes">
            {block.rows.map((row, r) => (
              <div key={r} className="chat-offer-size" data-tone={row.tone}>
                <dt className="num">{row.value}</dt>
                <dd className="chat-offer-what">{row.what}</dd>
                <dd className="chat-offer-source">{row.source}</dd>
              </div>
            ))}
          </dl>
        )
      )}
    </div>
  )
}
