import { useState } from 'react'
import { number } from '../../../shared/format'
import { type MainAxis, mainPlaneFrame } from '../../../shared/planes'
import { actions, useStore } from '../../state/store'
import { tracingActions, useTracings } from '../../state/tracings'
import { Field } from '../Field'
import { Band, BandButton, useBand } from '../view/Band'

/** The planes a tracing can lie on without anything picked: the three the axes span, as the model is seen from the front, the top and the right. */
const PLANES: ReadonlyArray<{ axis: MainAxis; name: string }> = [
  { axis: 'XZ', name: 'Front' },
  { axis: 'XY', name: 'Top' },
  { axis: 'YZ', name: 'Right' }
]

/**
 * Where a new tracing lies: on one of the main planes (with how far along its normal, typed), on the section on screen, or
 * on a face of the model (the view goes to it, and the next flat face selected is the one). In a popover under the picker, and
 * in the view of a project that has none yet.
 */
export function NewTracing({ onDone }: { onDone: () => void }) {
  const section = useStore((s) => s.section)
  const [axis, setAxis] = useState<MainAxis>('XZ')
  const [offset, setOffset] = useState(0)
  const [name, setName] = useState('')
  const refused = useTracings((s) => s.refused)
  const frame = mainPlaneFrame(axis, offset)
  const made = (on: Parameters<typeof tracingActions.make>[0]) => (): void => void tracingActions.make(on, name).then((tracing) => tracing !== null && onDone())
  return (
    <div className="tr-new" role="group" aria-label="New tracing">
      <div className="tr-new-planes" role="group" aria-label="Plane">
        {PLANES.map((plane) => (
          <button key={plane.axis} type="button" className="bar-button" aria-pressed={axis === plane.axis} onClick={() => setAxis(plane.axis)}>
            {plane.name} <span className="num">{plane.axis}</span>
          </button>
        ))}
      </div>
      <Field label="Offset along the plane's normal, in millimetres" sign="offset" value={number(offset)} unit="mm" commit={(mm) => setOffset(mm)} />
      <p className="tr-new-plane num">{frame.label}</p>
      <input
        className="tr-new-name"
        type="text"
        aria-label="Name of the tracing"
        placeholder="Name (optional)"
        maxLength={80}
        spellCheck={false}
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <div className="tr-new-actions">
        <button type="button" className="bar-button" data-primary="" onClick={made({ main: axis, offset })}>
          Make on this plane
        </button>
        <button type="button" className="bar-button" disabled={!section} title={section ? 'The cut the view is showing now' : 'Cut the parts with the Section tool first'} onClick={made({ section: true })}>
          On the section on screen
        </button>
        <button
          type="button"
          className="bar-button"
          title="Go to the model and click a flat face"
          onClick={() => {
            tracingActions.pickFace()
            onDone()
          }}
        >
          On a face
        </button>
      </div>
      {refused !== null && (
        <p className="tr-refused" role="status">
          {refused}
        </p>
      )}
    </div>
  )
}

/** The quiet band over the model while a tracing on a face waits for its face: says what to click, and gives the wait up. */
export function FacePickBar() {
  const refused = useTracings((s) => s.refused)
  const band = useBand()
  if (band !== 'facePick') return null
  return (
    <Band kind="facePick" label="Tracing on a face" part="face-pick">
      <span>Click a flat face for the tracing</span>
      {refused !== null && (
        <span className="tr-refused" role="status">
          {refused}
        </span>
      )}
      <BandButton
        onClick={() => {
          tracingActions.cancelFace()
          actions.setSelection([])
        }}
      >
        Cancel
      </BandButton>
    </Band>
  )
}
