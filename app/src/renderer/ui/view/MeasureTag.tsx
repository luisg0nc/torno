import { hint } from '../../../shared/keys'
import { valueParts } from '../../../shared/dimension'
import { componentsOf, keepHeld, useHeld } from '../../state/measured'
import { useStore } from '../../state/store'
import { commitMark } from '../../tools/pickMarks'
import { readingAt } from '../../viewport/heldValue'
import { Tag } from './Tag'

/**
 * The reading of the last measurement, a tag at the middle of the measured line (spec 2026-11-18 section 2): the kernel's value
 * large with its unit quiet, how it was taken and that it is exact (with a distance's `Δ` per axis), and **Keep as a
 * dimension** `Enter` as its primary button (as `Enter` does). Kept, the button gives way to the mark's number. Only of the
 * object and build on show: of any other it is not shown. It changes once per measurement, never per pointer move.
 * A kept dimension main refuses is a problem, a second tag. (What the kernel refuses to measure is said at the pointer.)
 */
export function MeasureTag() {
  const held = useHeld((s) => s.held)
  const keeping = useHeld((s) => s.keeping)
  const refused = useHeld((s) => s.refused)
  const objectId = useStore((s) => s.objectId)
  const revision = useStore((s) => s.revision)
  if (!held || held.objectId !== objectId || held.revision !== revision) return null
  const parts = valueParts(held.measure, held.value)
  const at = readingAt(held)
  return (
    <>
      <Tag id="measure" subject={at} prefer="left">
        <span className="measure-reading tag-reading">
          {parts.prefix}
          <span className="measure-number">{parts.number}</span>
          <span className="tag-unit">{parts.unit}</span>
        </span>
        <span className="measure-words" title={`Measured on r${held.revision}, not kept: the agent is not told`}>
          {held.how}, exact
          {componentsOf(held)?.map(([axis, text]) => (
            <span key={axis} className="measure-delta">
              {' · '}Δ{axis} <span className="num">{text}</span>
            </span>
          ))}
        </span>
        {held.kept !== undefined ? (
          <span className="measure-kept" role="status">
            Kept as <span className="num">{held.kept}</span>
          </span>
        ) : (
          <button
            type="button"
            className="tag-control measure-keep"
            data-primary=""
            disabled={keeping}
            aria-keyshortcuts={hint('measure.keep')}
            title={`Keep it as a dimension (${hint('measure.keep')}): a mark, measured again on every build, sent with the next prompt`}
            onClick={() => void keepHeld(commitMark).catch(() => {})}
          >
            Keep as a dimension
            <kbd aria-hidden="true">{hint('measure.keep')}</kbd>
          </button>
        )}
      </Tag>
      {refused !== null && held.kept === undefined && (
        <Tag id="measure-problem" subject={at} prefer="below" problem status>
          {refused}
        </Tag>
      )}
    </>
  )
}
