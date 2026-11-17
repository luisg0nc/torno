import { MAX_LABEL_TEXT, type LayerShape } from '../../../shared/tracings'
import { SNAP_PX } from './snap'

// The Trace tool's own state, apart from the screen: what the person has put down so far of a line, a circle or a label, and
// what a click, Enter, Backspace and Esc do to it. A finished shape goes to `finish` at once, one for each; nothing here is
// held in React, and the sheet draws what is under way from `elements` onto a layer of its own, on every move of the pointer.

export type TraceMode = 'line' | 'circle' | 'label'

export const TRACE_MODES: ReadonlyArray<{ mode: TraceMode; label: string; title: string }> = [
  { mode: 'line', label: 'Line', title: 'Click the points of a line; Enter ends it, a click on its first point closes it' },
  { mode: 'circle', label: 'Circle', title: 'Click its centre, then a point on it' },
  { mode: 'label', label: 'Label', title: 'Click where the label goes, then type it' }
]

/** A point the pointer gives: its place in the plane in mm, and whether it was snapped to a point of the model. */
export interface Click {
  uv: [number, number]
  snapped: boolean
}

export interface Draft {
  /** A line's points so far, or a circle's centre. */
  points: [number, number][]
  /** Where a label waits for its text. */
  label: [number, number] | null
}

/** A free click is kept to a ten thousandth of a millimetre: finer than a pixel at the closest zoom, and no float noise. A snapped point is the kernel's, in full. */
const free = (n: number): number => Math.round(n * 1e4) / 1e4 + 0

const mm = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)

export class TraceTool {
  mode: TraceMode = 'line'
  private points: [number, number][] = []
  private label: [number, number] | null = null

  /** `finish` gets each finished shape; `changed` is told when what is under way has. */
  constructor(
    private readonly finish: (shape: LayerShape) => void,
    private readonly changed: () => void = () => {}
  ) {}

  get draft(): Draft {
    return { points: this.points, label: this.label }
  }

  /** Whether anything is under way: a point put down, or a label waiting for its text. */
  get active(): boolean {
    return this.points.length > 0 || this.label !== null
  }

  /** How the tool traces: what is under way is dropped. */
  setMode(mode: TraceMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.points = []
    this.label = null
    this.changed()
  }

  /** A click on the sheet, `pxPerMm` being how large a millimetre is on screen: it is the judge of a click on the first point and of one that is no new point. */
  click(at: Click, pxPerMm: number): void {
    const uv: [number, number] = at.snapped ? [at.uv[0], at.uv[1]] : [free(at.uv[0]), free(at.uv[1])]
    if (!Number.isFinite(uv[0]) || !Number.isFinite(uv[1]) || !(pxPerMm > 0)) return
    const half = 0.5 / pxPerMm
    const away = (from: readonly [number, number]): number => Math.hypot(uv[0] - from[0], uv[1] - from[1])
    if (this.mode === 'label') {
      this.label = uv
      return this.changed()
    }
    if (this.mode === 'circle') {
      const [centre] = this.points
      if (centre === undefined) {
        this.points = [uv]
        return this.changed()
      }
      if (away(centre) <= half) return
      this.points = []
      this.changed()
      this.finish({ kind: 'circle', centre: [centre[0], centre[1]], radius: away(centre) })
      return
    }
    const last = this.points.at(-1)
    if (last !== undefined && away(last) <= half) return
    if (this.points.length >= 3 && away(this.points[0]) <= SNAP_PX / pxPerMm) return this.done(true)
    // Before it has three, a click where the first point is is no new point either: a line is not drawn back on itself.
    if (this.points.length > 0 && this.points.length < 3 && away(this.points[0]) <= SNAP_PX / pxPerMm) return
    this.points = [...this.points, uv]
    this.changed()
  }

  /** Enter: a line of two points or more ends, open. Anything else has nothing to end. */
  end(): boolean {
    if (this.mode !== 'line' || this.points.length < 2) return false
    this.done(false)
    return true
  }

  private done(closed: boolean): void {
    const points = this.points.map((p): [number, number] => [p[0], p[1]])
    this.points = []
    this.changed()
    this.finish({ kind: 'polyline', points, ...(closed ? { closed: true as const } : {}) })
  }

  /** Backspace: the last point, or the label's place, taken away. */
  back(): boolean {
    if (this.label !== null) {
      this.label = null
    } else if (this.points.length > 0) {
      this.points = this.points.slice(0, -1)
    } else return false
    this.changed()
    return true
  }

  /** Esc: all that is under way given up. True when there was something. */
  cancel(): boolean {
    if (!this.active) return false
    this.points = []
    this.label = null
    this.changed()
    return true
  }

  /** The label's text, typed: one line, trimmed, at most `MAX_LABEL_TEXT` characters. With none, the label is let go. */
  text(value: string): boolean {
    const at = this.label
    if (at === null) return false
    const text = value.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_TEXT)
    this.label = null
    this.changed()
    if (text === '') return false
    this.finish({ kind: 'label', at: [at[0], at[1]], text })
    return true
  }

  /**
   * What is under way, as the elements of a layer in the sheet's own millimetres (`down` says whether the plane's v runs down
   * the screen): the line so far to the pointer, a ring on the first point when a click there would close it, the circle the
   * pointer would make, the place of a label. The shapes are stroked in the layer's colour by the stylesheet's `.tr-draft`.
   * `hover` is where the pointer is in the plane, or null off the sheet.
   */
  elements(hover: readonly [number, number] | null, down: boolean, pxPerMm: number): string {
    const at = (p: readonly [number, number]): [number, number] => [p[0], down ? p[1] : -p[1]]
    const pt = (p: readonly [number, number]): string => at(p).map(mm).join(' ')
    const dot = 3 / pxPerMm
    const out: string[] = []
    if (this.label !== null) {
      const [x, y] = at(this.label)
      out.push(`<circle class="tr-draft-at" cx="${mm(x)}" cy="${mm(y)}" r="${mm(dot)}"/>`)
    } else if (this.mode === 'circle' && this.points.length === 1) {
      const [x, y] = at(this.points[0])
      out.push(`<circle class="tr-draft-dot" cx="${mm(x)}" cy="${mm(y)}" r="${mm(dot)}"/>`)
      if (hover !== null) {
        const r = Math.hypot(hover[0] - this.points[0][0], hover[1] - this.points[0][1])
        if (r > 0) out.push(`<circle class="tr-draft-line" cx="${mm(x)}" cy="${mm(y)}" r="${mm(r)}"/>`)
      }
    } else if (this.mode === 'line' && this.points.length > 0) {
      const way = [...this.points, ...(hover === null ? [] : [hover])]
      if (way.length > 1) out.push(`<path class="tr-draft-line" d="M${way.map(pt).join(' L')}" fill="none"/>`)
      for (const p of this.points) {
        const [x, y] = at(p)
        out.push(`<circle class="tr-draft-dot" cx="${mm(x)}" cy="${mm(y)}" r="${mm(dot)}"/>`)
      }
      if (hover !== null && this.points.length >= 3 && Math.hypot(hover[0] - this.points[0][0], hover[1] - this.points[0][1]) <= SNAP_PX / pxPerMm) {
        const [x, y] = at(this.points[0])
        out.push(`<circle class="tr-draft-close" cx="${mm(x)}" cy="${mm(y)}" r="${mm(2 * dot)}"/>`)
      }
    }
    return out.join('')
  }
}
