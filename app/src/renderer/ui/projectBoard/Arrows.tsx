import { memo, useMemo } from 'react'
import type { Arrow, Card } from '../../../shared/board'
import { arrowLine } from './geometry'

/**
 * The arrows between cards, drawn in the same space as the cards, so that the camera moves them with the layer. An arrow
 * runs from the edge of one card to the edge of the other; a word on it sits at its middle. An arrow to a card that is
 * hidden or gone is not drawn.
 */
export const Arrows = memo(function Arrows({ cards, arrows, selected }: { cards: readonly Card[]; arrows: readonly Arrow[]; selected: readonly string[] }) {
  const byId = useMemo(() => new Map(cards.filter((c) => !c.hidden).map((c) => [c.id, c])), [cards])
  return (
    <svg className="pboard-arrows" width="1" height="1" aria-hidden="true">
      <defs>
        {(['person', 'agent'] as const).map((by) => (
          <marker key={by} id={`pboard-head-${by}`} className="pboard-arrowhead" data-by={by} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 0 1 L 10 5 L 0 9 z" />
          </marker>
        ))}
      </defs>
      {arrows.map((arrow) => {
        const from = byId.get(arrow.from)
        const to = byId.get(arrow.to)
        if (!from || !to) return null
        const { x1, y1, x2, y2 } = arrowLine(from, to)
        return (
          <g key={arrow.id} className="pboard-arrow" data-arrow={arrow.id} data-by={arrow.by} data-selected={selected.includes(arrow.id) ? '' : undefined}>
            <line className="pboard-arrow-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={`url(#pboard-head-${arrow.by})`} />
            {arrow.label && (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} textAnchor="middle" dominantBaseline="central">
                {arrow.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
})
