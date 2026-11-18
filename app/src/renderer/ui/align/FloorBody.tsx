import { fitNumber } from '../../../shared/format'
import { type AlignState, alignStore, floorWarning } from '../../state/align'
import { Field } from '../Field'
import { coords, shown } from './format'

export function FloorBody({ state }: { state: AlignState }) {
  const { floor, onto, choosingFace, height, flip } = state
  const share = floor?.of ? Math.round((100 * floor.plane.used) / floor.of) : null
  const warning = floor ? floorWarning(floor) : null
  return (
    <div className="alignbar-body" data-mode="floor">
      <div className="alignbar-row">
        <span className="alignbar-label">Lay on</span>
        <div className="segmented" role="group" aria-label="What the floor is laid on">
          <button type="button" aria-pressed={!onto && !choosingFace} title="The plane z = height" onClick={() => alignStore.setState({ onto: null, choosingFace: false })}>
            Ground
          </button>
          <button type="button" aria-pressed={onto !== null || choosingFace} title="A flat face of the model: click it" onClick={() => alignStore.setState({ choosingFace: true, onto: null })}>
            On a face
          </button>
        </div>
        {onto ? (
          <span className="alignbar-onto">
            <span className="num">{onto.part}</span> at <span className="num">{coords(onto.origin)}</span>
          </span>
        ) : (
          <Field label="Height in millimetres" sign="z" axis="z" unit="mm" value={shown(height)} disabled={choosingFace} commit={(value) => alignStore.setState({ height: value })} />
        )}
        <button type="button" className="procedure-button" aria-pressed={flip} disabled={!floor} title="Lay the scan the other way up" onClick={() => alignStore.setState({ flip: !flip })}>
          Flip
        </button>
      </div>
      {floor && (
        <p className="alignbar-fit" data-warn={warning ? '' : undefined}>
          Plane RMS <span className="num">{fitNumber(floor.plane.rms)}</span> mm over <span className="num">{floor.plane.used}</span> triangles
          {share !== null && floor.of !== 3 && (
            <>
              {' '}
              (<span className="num">{share}</span> % of the patch)
            </>
          )}
          {warning && <span data-part="warning"> · {warning}</span>}
        </p>
      )}
    </div>
  )
}
