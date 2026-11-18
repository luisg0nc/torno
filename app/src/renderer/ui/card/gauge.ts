import { number } from '../../../shared/format'

/** Floating point leaves `2.7499999999999996` where `2.75` was meant: the window is kept to a billionth. */
const tidy = (x: number): number => Math.round(x * 1e9) / 1e9

/**
 * What a gauge draws: the band widened by twice its width each side, or out to the value where that is further. An open end
 * (`null`) runs the window to the value plus the band's width, the band's width being how far the value stands from its one end.
 */
export function gaugeWindow(lo: number | null, hi: number | null, value: number): { min: number; max: number } {
  const apart = lo !== null && hi !== null ? hi - lo : Math.abs((lo ?? hi ?? value) - value)
  // A band that is a point, with the value on it, still has a window: a tenth of where it stands, or 1.
  const width = apart > 0 ? apart : Math.max(Math.abs(value) * 0.1, 1)
  const min = lo !== null ? Math.min(lo - 2 * width, value) : Math.min(value, hi ?? value) - width
  const max = hi !== null ? Math.max(hi + 2 * width, value) : Math.max(value, lo ?? value) + width
  return { min: tidy(min), max: tidy(max) }
}

/** Whether the value is inside what was wanted. */
export const gaugeInside = (value: number, lo: number | null, hi: number | null): boolean => (lo === null || value >= lo) && (hi === null || value <= hi)

/** The gauge in words, for its label: `2.8, outside 2.95 to 3.05`; `1.2, outside at least 1.6`. */
export function gaugeSaid(value: number, lo: number | null, hi: number | null): string {
  const wanted = lo !== null && hi !== null ? `${number(lo)} to ${number(hi)}` : lo !== null ? `at least ${number(lo)}` : hi !== null ? `at most ${number(hi)}` : 'anything'
  return `${number(value)}, ${gaugeInside(value, lo, hi) ? 'inside' : 'outside'} ${wanted}`
}
