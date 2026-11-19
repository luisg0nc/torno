import type { ReactNode, RefObject } from 'react'
import { LeftEdge } from '../LeftEdge'
import { Bench } from './Bench'
import { useColumnHead } from './InHand'
import { OnBlock } from './OnBlock'

/**
 * The project's left column: the card docked at the left, as wide as `--card-w` says. Its head slot (`head`: what is in your hand)
 * takes the place of the "On hN" block (`OnBlock`) while the sketch, a review round or a size being tied is in hand; the bench
 * (`Bench`: Parameters and Parts as two tabs) fills the rest of the column. Checks and Marks are on the Brief page, Scans and
 * Tracings are tabs of the view's switch with their panels beside the view. Its right edge makes it wider (`LeftEdge`).
 */
export function RouteCard({ head, shell }: { head?: ReactNode; shell: RefObject<HTMLDivElement | null> }) {
  const held = useColumnHead()
  return (
    <div className="route-card">
      {/* The sketch being drawn, the round whose panel is up or a size being tied take the "On" block's place; a selection is a tag by the part. */}
      {held ? <div className="route-hand">{head}</div> : <OnBlock />}
      <Bench />
      <LeftEdge shell={shell} />
    </div>
  )
}
