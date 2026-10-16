import { useState, type ReactNode } from 'react'
import { number } from '../../shared/format'
import { pressed } from '../../shared/keys'
import { type ScanInfo, type ScanUnit, type ScanUp, UNIT_MM, sizeAs } from '../../shared/scans'
import { actions } from '../state/store'
import { Confirm } from './Confirm'
import { numbered } from './numbered'
import { UNIT_WORD } from './scanState'
import { chosen, pointerChoice } from './typing'

const UNITS = Object.keys(UNIT_MM) as ScanUnit[]

/**
 * How a scan this window just imported is read, asked once, at the top of the Scans section: torno guessed its
 * unit or its up axis from the format and the size, and a wrong unit is a thousandfold. The scan is drawn in the
 * view meanwhile, which is the preview; the size it would have is said here. Not modal: "Later" (or Escape) puts
 * it away, and the question stays in the scan's detail.
 */
export function ScanReadSheet({ scan, convert, layoutsOf }: { scan: ScanInfo; convert: (as: { unit: ScanUnit; up: ScanUp }) => void; layoutsOf: (names: string[]) => ReactNode }) {
  const { id, imported } = scan
  const [unit, setUnit] = useState<ScanUnit>(imported.unit)
  const [up, setUp] = useState<ScanUp>(imported.up)
  const [asking, setAsking] = useState(false)
  const changed = unit !== imported.unit || up !== imported.up
  const layouts = Object.keys(scan.alignments)
  const size = sizeAs(imported, { unit, up })
    .map((c) => number(c))
    .join(' × ')
  const done = (as: { unit: ScanUnit; up: ScanUp }): void => {
    actions.askScanRead(null)
    convert(as)
  }

  return (
    <div
      className="scan-sheet"
      role="dialog"
      aria-label={`How is ${id} read?`}
      onKeyDown={(e) => {
        if (!asking && pressed(e, 'sheet.close')) {
          e.stopPropagation()
          actions.askScanRead(null)
        }
      }}
    >
      <p className="scan-sheet-text">
        <span className="num">{id}</span> was read as {UNIT_WORD[imported.unit]}, {imported.up.toUpperCase()} up: torno guessed from the format and the size.
      </p>
      <p className="scan-sheet-size" data-part="size">
        {numbered(`Its size would be ${size} mm`)}
      </p>
      <div className="scan-field">
        <select
          className="scan-select num"
          aria-label={`Unit of ${id}`}
          value={unit}
          {...pointerChoice}
          onChange={(e) => {
            setUnit(e.target.value as ScanUnit)
            chosen(e.currentTarget)
          }}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select
          className="scan-select"
          aria-label={`Up axis of ${id}`}
          value={up}
          {...pointerChoice}
          onChange={(e) => {
            setUp(e.target.value as ScanUp)
            chosen(e.currentTarget)
          }}
        >
          <option value="y">Y up</option>
          <option value="z">Z up</option>
        </select>
        <span className="spacer" />
        <button type="button" className="button" title="Keeps the scan as it was read, and no longer asks" onClick={() => done({ unit: imported.unit, up: imported.up })}>
          Keep
        </button>
        <button type="button" className="button" title={changed ? undefined : 'Choose another unit or up axis first'} disabled={!changed} onClick={() => (layouts.length > 0 ? setAsking(true) : done({ unit, up }))}>
          Apply
        </button>
        <button type="button" className="button button-quiet" title="Asks again in the scan's detail" onClick={() => actions.askScanRead(null)}>
          Later
        </button>
      </div>
      {asking && (
        <Confirm label={`Drop the alignment of ${id}?`} accept="Change" cancel="Keep as it is" onCancel={() => setAsking(false)} onAccept={() => done({ unit, up })}>
          Changing the unit or the up axis of <span className="num">{id}</span> drops its alignment in {layoutsOf(layouts)}.
        </Confirm>
      )}
    </div>
  )
}
