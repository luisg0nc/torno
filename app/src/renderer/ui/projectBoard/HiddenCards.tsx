import { useState } from 'react'
import type { Card } from '../../../shared/board'
import { faceOf } from './faces'
import { showAgain } from './ops'

/** What names a hidden card in the list: what it is and what it shows ("Mark M3", "Reference photo.jpg"). */
function nameOf(card: Card): string {
  const face = faceOf(card, {})
  const what = card.source?.replace(/^reference\//, '') ?? face.title ?? card.id
  return `${face.label} ${what}`
}

/**
 * "Hidden cards": the cards that appeared by themselves and were taken off the board, which stay hidden until shown
 * again. Nothing is drawn while none is hidden.
 */
export function HiddenCards({ objectId, cards }: { objectId: string; cards: readonly Card[] }) {
  const [open, setOpen] = useState(false)
  const hidden = cards.filter((c) => c.hidden)
  if (hidden.length === 0) return null
  return (
    <div className="pboard-hidden">
      <button type="button" className="pboard-hidden-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Hidden cards <span className="num">{hidden.length}</span>
      </button>
      {open && (
        <ul className="pboard-hidden-list">
          {hidden.map((card) => (
            <li key={card.id} className="pboard-hidden-item">
              <span className="pboard-hidden-name">
                {nameOf(card)} <span className="num">{card.id}</span>
              </span>
              <button type="button" onClick={() => void showAgain(objectId, card.id)}>
                Show again
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
