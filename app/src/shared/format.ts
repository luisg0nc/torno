/** A length or a coordinate smaller than this is what modelling leaves where it means nothing. */
const NOISE = 1e-6

/**
 * A number with at most four significant digits and no trailing zeros, as the
 * kernel writes them in descriptors (`number` in kernel/src/torno_kernel/describe.py).
 * Millimetres are meant: a magnitude under a millionth is written `0`. Every
 * number shown or told is written so; what is stored is full precision.
 */
export function number(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Math.abs(value) < NOISE) return '0'
  const decimals = 3 - Math.floor(Math.log10(Math.abs(value)))
  if (decimals <= 0) {
    const step = 10 ** -decimals
    return String(Math.round(value / step) * step)
  }
  const text = value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')
  return text === '-0' ? '0' : text
}

/** What of a part's extent is nothing: a coordinate or a size under a millionth of the diagonal of its box (the kernel's rule, `describe.number`'s `least`). */
export const OF_THE_PART = 1e-6

/**
 * `number`, of a coordinate or a size of something `extent` millimetres across: what is under a millionth of
 * that is what modelling left where 0 was meant, and is written `0`. (`-0.000004772` on a part of 270 mm.)
 */
export function numberWithin(value: number, extent: number): string {
  return Math.abs(value) < Math.max(NOISE, OF_THE_PART * extent) ? '0' : number(value)
}

/**
 * How well something fits, in millimetres: `number`, of the value to the thousandth. What a fit of clicked
 * points leaves is never known finer than that, and `0.000004247 mm` says nothing `0 mm` does not.
 */
export function fitNumber(mm: number): string {
  return number(Math.round(mm * 1000) / 1000)
}

/**
 * A size found by bisection to the thousandth of a millimetre (a fillet's largest radius, `diagnosis.ts`): to
 * the thousandth whatever its magnitude, so that `59.999` is never told as the `60` that failed.
 */
export function thousandth(mm: number): string {
  const text = (Math.round(mm * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return text === '-0' ? '0' : text
}

/**
 * A length or a coordinate taken from a scan, in millimetres: to the tenth, and never -0. A scan is true to a
 * few millimetres at best; `0.008139 mm` of one says nothing `0 mm` does not, and reads as if it did.
 */
export function scanNumber(mm: number): string {
  return number(Math.round(mm * 10) / 10 + 0)
}

/**
 * A figure of a fit as the agent is told it, less its unit: to a tenth of a millimetre, as everything a reading
 * takes from a scan is (`scanNumber`), and `under 0.1` below half of that. A few clicked points fitted to the
 * micron are no finer than the scan they were clicked on; the data keeps the numbers in full.
 */
export function tenth(mm: number): string {
  return Math.abs(mm) < 0.05 ? 'under 0.1' : scanNumber(mm)
}

/** Three significant digits, no trailing zeros. */
const three = (n: number): string => String(Number(n.toPrecision(3)))

/** A count of tokens to three digits: `742`, `14.2 k`, `1.18 M`. */
export function tokens(n: number): string {
  if (Math.abs(n) < 1000) return String(Math.round(n))
  if (Number(Math.abs(n / 1e3).toPrecision(3)) < 1000) return `${three(n / 1e3)} k`
  return `${three(n / 1e6)} M`
}

/** A cost in US dollars, as Claude Code estimates one: to the cent (`$0.64`, `$10.80`), whole from $100, `under $0.01` for less than a cent. */
export function dollars(usd: number): string {
  if (usd === 0) return '$0'
  if (Math.abs(usd) < 0.005) return 'under $0.01'
  if (Math.abs(usd) >= 100) return `$${count(Math.round(usd))}`
  return `$${usd.toFixed(2)}`
}

/** How many of something: a whole number with its thousands set apart, `1,598,472`. */
export function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** What names a build (`r12`) or a part's face or edge (`plate/E7`) in a sentence. */
const NAMED = /(\br\d+\b|[\w.-]+\/(?:[FE]\d+|@[A-Za-z_]\w*(?:[.-]\w+)*)\b)/

/**
 * A sentence in pieces: every second one, from the second, names a build or
 * a ref, and is set in the face of numbers wherever the sentence is shown,
 * as every number and ref is. (`['not measured on ', 'r12', '']`.)
 */
export function namedPieces(text: string): string[] {
  return text.split(NAMED)
}

/** What a file weighs: bytes under a kilobyte, then kilobytes (1024 bytes) and megabytes to a tenth under ten, whole above. `812 B`, `7.1 KB`, `12 KB`. */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n < 1024) return `${Math.round(n)} B`
  const unit = n < 1024 * 1024 ? { size: 1024, name: 'KB' } : { size: 1024 * 1024, name: 'MB' }
  const value = n / unit.size
  return `${number(value < 10 ? Math.round(value * 10) / 10 : Math.round(value))} ${unit.name}`
}

/** A plane's offset (and the readout that follows its handle): to a tenth of a millimetre with the tenth always written, `40.0`, as a plane's label is; never -0. */
export function offsetNumber(mm: number): string {
  return (Math.round(mm * 10) / 10 + 0).toFixed(1)
}
