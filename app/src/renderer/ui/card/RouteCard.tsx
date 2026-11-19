import type { ReactNode, RefObject } from 'react'
import { useBoard } from '../../state/board'
import { useStore } from '../../state/store'
import { useTracings } from '../../state/tracings'
import { LeftEdge } from '../LeftEdge'
import { ScansSide } from '../ScansPanel'
import { Bench } from './Bench'
import { useColumnHead } from './InHand'
import { OnBlock } from './OnBlock'
import { TracingsSide } from './Tracings'

/**
 * The project's left column: the card docked at the left, as wide as `--card-w` says. Its head slot (`head`: what is in your hand)
 * takes the place of the "On hN" block (`OnBlock`) while the sketch, a review round or a size being tied is in hand; the bench
 * (`Bench`: Parameters and Parts as two tabs) fills the rest of the column, and gives it to the panel of the Scans or the Tracing view
 * (`ScansSide`, `TracingsSide`) while that view is shown and the project has one. Checks and Marks are on the Brief page, Scans and
 * Tracings are tabs of the view's switch. Its right edge makes it wider (`LeftEdge`).
 */
export function RouteCard({ head, shell }: { head?: ReactNode; shell: RefObject<HTMLDivElement | null> }) {
  const held = useColumnHead()
  const shown = useBoard((s) => s.shown)
  const hasScans = useStore((s) => s.scans.length > 0 || s.scansProblem !== null || s.scansRefused !== null)
  const hasTracings = useTracings((s) => (s.file?.tracings.length ?? 0) > 0)
  return (
    <div className="route-card">
      {/* The sketch being drawn, the round whose panel is up or a size being tied take the "On" block's place; a selection is a tag by the part. */}
      {held ? <div className="route-hand">{head}</div> : <OnBlock />}
      {shown === 'scans' && hasScans ? <ScansSide /> : shown === 'tracing' && hasTracings ? <TracingsSide /> : <Bench />}
      <LeftEdge shell={shell} />
    </div>
  )
}
