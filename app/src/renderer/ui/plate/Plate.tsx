import type { ReactNode } from 'react'
import { ScribedVise } from './ScribedVise'

/**
 * The dyed plate: layout blue, the field a machinist paints on steel before scribing, with the vise scribed on it, a
 * headline at its foot and the words under it. It is for the screens that show no model (the first screen, the empty
 * folder, the new project's prompt) and for nothing else. It fills the box it is in; the screen that holds it sets the
 * box's width (the first screen's is 780 of 1440).
 *
 * `lead`: the words under the headline in `--on-dye-muted`; what is to be read first goes in a `<strong>`, which is
 * `--on-dye`. `drawing`: `vise` draws it, `vise-unknown` draws it with nothing yet in the jaws (`? mm`).
 */
export function Plate({ headline, lead, drawing = 'vise' }: { headline: string; lead?: ReactNode; drawing?: 'vise' | 'vise-unknown' }) {
  return (
    <section className="plate" data-plate data-drawing={drawing}>
      <ScribedVise unknown={drawing === 'vise-unknown'} />
      <h1 className="plate-headline">{headline}</h1>
      {lead !== undefined && <p className="plate-lead">{lead}</p>}
    </section>
  )
}
