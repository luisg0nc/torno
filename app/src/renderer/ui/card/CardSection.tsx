import type { ReactNode } from 'react'
import { actions, useStore } from '../../state/store'
import { giveKeysBack } from '../typing'
import type { SectionId } from './sections'

/**
 * One section of the route card: a dot on the route, a head (the name at 16 px, 600, and under or beside it `said`, one line of
 * what the section holds, in the monospace face, cut with an ellipsis) and the body. A click on the head folds the section to
 * that head, or unfolds it; one with nothing in it (`empty`) says "none" and does not unfold. A folded section draws no body.
 * The dot is hollow, filled in the accent for the section in sight (`data-here`, set by the card) and ringed in the failure's
 * colour where something in it fails or waits (`data-needs`). What the section has to do from its head (`action`: Import scan…)
 * stands at the right of the head's line, beside the head's button and not in it, so that a click on it does not fold the section.
 */
export function CardSection({ id, title, said, needs = false, empty = false, action, children }: { id: SectionId; title: string; said: ReactNode; needs?: boolean; empty?: boolean; action?: ReactNode; children?: ReactNode }) {
  const folded = useStore((s) => s.column.folded.includes(id))
  const here = useStore((s) => s.sectionHere === id)
  const shut = folded || empty
  return (
    <section className="route-section" data-section={id} data-folded={shut ? '' : undefined} data-here={here ? '' : undefined} data-needs={needs ? '' : undefined} data-empty={empty ? '' : undefined} aria-labelledby={`route-head-${id}`}>
      <h2 className="route-head" id={`route-head-${id}`}>
        <button
          type="button"
          className="route-head-button"
          aria-expanded={!shut}
          aria-disabled={empty ? 'true' : undefined}
          onClick={(e) => {
            if (!empty) actions.toggleSection(id)
            if (e.detail > 0) giveKeysBack(e.currentTarget)
          }}
        >
          <span className="route-title">{title}</span>
          <span className="route-said">{said}</span>
        </button>
        {action}
      </h2>
      {!shut && <div className="route-body">{children}</div>}
    </section>
  )
}
