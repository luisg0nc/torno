import { shownTracings } from '../state/tracingsIn3d'
import { actions, useStore } from '../state/store'
import { boardActions } from '../state/board'
import { tracingActions, useTracings } from '../state/tracings'
import { tracingName, type Tracing } from '../../shared/tracings'
import { giveKeysBack } from './typing'
import { EyeIcon } from './Layers'

/** What a plane is called without its axes: `XZ at y = 0.0`. */
const planeName = (t: Pick<Tracing, 'plane'>): string => t.plane.label.replace(/ \(.*$/, '')

/**
 * The tracings shown in the model view, in the layers list: a row for each of the layout shown, with the eye that puts it away (it is then shown no
 * more: the button of its panel shows it again). There is no row while none is shown. Marks on a tracing are drawn with the marks, whatever is
 * done here; this is the tracing itself, its photo and its layers.
 */
export function TracingRows({ layout }: { layout: string }) {
  const shown = useStore((s) => s.tracingsShown)
  const tracings = useTracings((s) => s.file?.tracings)
  const rows = shownTracings(shown, tracings).filter((t) => t.layout === layout)
  if (rows.length === 0) return null
  return (
    <div className="layer-tracings" data-part="tracings">
      <h3 className="layer-sets-head">Tracings</h3>
      <ul className="rows">
        {rows.map((t) => (
          <li key={t.id} className="row layer-row layer-tracing" data-tracing={t.id}>
            <span className="swatch tracing-swatch" aria-hidden="true" />
            <button
              type="button"
              className="row-name layer-name num"
              title="Open this tracing"
              onClick={(e) => {
                tracingActions.open(t.id)
                boardActions.show('tracing')
                if (e.detail > 0) giveKeysBack(e.currentTarget)
              }}
            >
              {tracingName(t)}
            </button>
            <span className="layer-count num">{planeName(t)}</span>
            <button type="button" className="icon-button" aria-pressed={true} aria-label={`Hide ${t.id} in 3D`} title="Hide in 3D" onClick={() => actions.setTracingShown(t.id, false)}>
              <EyeIcon open />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
