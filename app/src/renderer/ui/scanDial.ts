import { number } from '../../shared/format'
import type { Vec3 } from '../../shared/marks'
import { type ScanUnit, UNIT_MM } from '../../shared/scans'

/** The units of the scan read question's dial, in the order it shows them. */
export type DialUnit = ScanUnit | 'ft'

/** A foot in millimetres. */
const FOOT_MM = 304.8

const DIAL: ReadonlyArray<[DialUnit, number]> = [
  ['mm', UNIT_MM.mm],
  ['cm', UNIT_MM.cm],
  ['m', UNIT_MM.m],
  ['in', UNIT_MM.in],
  ['ft', FOOT_MM]
]

/**
 * What each cell of the dial says: the longest side of the scan, as it would be if it were read in that unit, in the
 * mono form of `shared/format.ts` (`0.412`, `4.12`, `412`, `10.46`, `125.6`). `asRead` is the size of the scan's box
 * in the units of the file, as read.
 */
export function dialSizes(asRead: Vec3): Array<{ unit: DialUnit; size: string }> {
  const longest = Math.max(...asRead.map(Math.abs))
  return DIAL.map(([unit, mm]) => ({ unit, size: number(longest * mm) }))
}

/**
 * The scan's box drawn at the size another unit would give it: `drawn` is the box as it stands, `k` how many times
 * larger that unit makes the scan (the unit's millimetres over those of the unit it is read in). The lowest corner
 * stays where it is, so the dashed box grows out from the corner the card is tied to.
 */
export function askedBox(drawn: { min: Vec3; max: Vec3 }, k: number): { min: Vec3; max: Vec3 } {
  const { min, max } = drawn
  return { min: [...min], max: [min[0] + (max[0] - min[0]) * k, min[1] + (max[1] - min[1]) * k, min[2] + (max[2] - min[2]) * k] }
}
