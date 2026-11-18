import type { CSSProperties } from 'react'
import { number } from '../../../shared/format'
import { gaugeInside, gaugeSaid, gaugeWindow } from './gaugeWindow'

const W = 64
const H = 16
const MID = H / 2

/** What a gauge needs of a row: the value measured (null where it was not), what was wanted (null at an open end), and how it stands. */
export interface GaugeRow {
  value: number | null
  lo: number | null
  hi: number | null
  /** How it stands: `fails` colours the tick as a value outside the band does. */
  verdict?: string
  /** Where the value was at the build before: the tick slides from there. */
  from?: number | null
}

/**
 * The wanted band and the value measured against it, 64 by 16: a hairline axis, the band as a 6 px rect with a cap at each closed
 * end (an open end has none and runs off the side), and the value as a 2 px tick, in the colour of passing inside the band and of
 * failing outside it. Outside, a dashed line runs from the tick to the near end. A tick that moved since the build before slides
 * from where it was, once, in 0.7 s (not under reduced motion). Its label is in words.
 */
export function Gauge({ value, lo, hi, verdict, from = null }: GaugeRow) {
  if (lo === null && hi === null) return null
  const known = value !== null
  const win = gaugeWindow(lo, hi, value ?? lo ?? hi ?? 0)
  // Without a value the window is the band's own (the value was taken to be at one end of it).
  const at = (v: number): number => ((v - win.min) / (win.max - win.min)) * (W - 4) + 2
  const x0 = lo === null ? 0 : at(lo)
  const x1 = hi === null ? W : at(hi)
  const inside = known && gaugeInside(value, lo, hi)
  const state = inside && verdict !== 'fails' ? 'inside' : 'outside'
  const label = known ? gaugeSaid(value, lo, hi) : `not measured, wanted ${lo !== null && hi !== null ? `${number(lo)} to ${number(hi)}` : lo !== null ? `at least ${number(lo)}` : `at most ${number(hi as number)}`}`
  const tickX = known ? at(value) : 0
  const slid = known && from !== null && from !== value ? at(from) - tickX : null
  // The near end of the band, for the dashed line of a value outside it.
  const near = known && !inside ? (lo !== null && value < lo ? x0 : x1) : null
  return (
    <svg className="gauge" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line className="gauge-axis" x1={0} y1={MID} x2={W} y2={MID} />
      <rect className="gauge-band" x={x0} y={MID - 3} width={Math.max(x1 - x0, 1)} height={6} rx={1} />
      {lo !== null && <rect className="gauge-cap" x={x0 - 0.75} y={MID - 4} width={1.5} height={8} />}
      {hi !== null && <rect className="gauge-cap" x={x1 - 0.75} y={MID - 4} width={1.5} height={8} />}
      {near !== null && <line className="gauge-gap" x1={tickX} y1={MID} x2={near} y2={MID} />}
      {known && <rect key={value} className="gauge-tick" data-state={state} x={tickX - 1} y={1} width={2} height={14} rx={1} style={slid === null ? undefined : ({ '--slide': `${slid}px` } as CSSProperties)} />}
    </svg>
  )
}
