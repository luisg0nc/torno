import { type ExportChecked, FORMAT_NAMES } from '../../../shared/exportdata'
import { count, number } from '../../../shared/format'

/** `2 parts`, the number in the face of numbers. */
export function Count({ n, one, many = `${one}s` }: { n: number; one: string; many?: string }) {
  return (
    <>
      <span className="num">{count(n)}</span> {n === 1 ? one : many}
    </>
  )
}

/** What the read-back of a file of the model found, in a line: checked, not printed. */
export function Checked({ checked }: { checked: ExportChecked }) {
  const n = checked.parts.length
  if (checked.format === 'step') {
    return (
      <p className="export-checked">
        Checked: STEP read back, <Count n={n} one="part" /> by name, <Count n={checked.solids ?? 0} one="solid" />, each volume and box as the model's.
      </p>
    )
  }
  return (
    <p className="export-checked">
      Checked: {FORMAT_NAMES[checked.format]}, <Count n={n} one={checked.format === '3mf' ? 'object' : 'part'} />, <Count n={checked.triangles ?? 0} one="triangle" />, closed
      {checked.volumeDeviation !== null && (
        <>
          , volume within <span className="num">{number(checked.volumeDeviation)} %</span> of the model
        </>
      )}
      . Checked, not printed.
    </p>
  )
}
