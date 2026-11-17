import { number } from '../../../shared/format'
import type { SpanEndDraft } from '../../../shared/bridge'
import type { PlaneSnap } from '../../../shared/tracings'

// The Measure tool's own state, apart from the screen: the first end clicked, which waits for the second. Two clicks make a span
// (`finish`); a click on a point of the cut's it snaps to is the kernel's point, and a span with both ends snapped is exact, which main
// judges and says (`spanValue`). What is shown here while the second end is chosen is the number the span would have, `≈` unless both
// ends are snapped. Nothing here is held in React: the sheet draws it from `elements`.

/** A free click is kept to a ten thousandth of a millimetre; a snapped point is the kernel's, in full (as the Pin tool keeps them). */
const free = (n: number): number => Math.round(n * 1e4) / 1e4 + 0
const mm = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)

/** A click on the sheet: the point of the plane, the point of the cut's it snapped to when it did, and whether a free click is on the photo. */
export interface MeasureClick {
  uv: readonly [number, number]
  snap?: PlaneSnap
  /** A free click that lies on the photo, not on the outline. */
  photo?: boolean
}

export function endOf(at: MeasureClick): SpanEndDraft {
  if (at.snap) return { uv: [at.snap.uv[0], at.snap.uv[1]], on: 'tracing', snap: at.snap }
  return { uv: [free(at.uv[0]), free(at.uv[1])], on: at.photo === true ? 'photo' : 'tracing' }
}

const exactly = (a: SpanEndDraft, b: SpanEndDraft): boolean => a.snap !== undefined && b.snap !== undefined && a.on === 'tracing' && b.on === 'tracing'

/** The number a span between two ends would have, as the readout says it: `41.8 mm`, and `≈ 41.8 mm` unless both ends are snapped. */
export function spanReadout(a: SpanEndDraft, b: SpanEndDraft): string {
  return `${exactly(a, b) ? '' : '≈ '}${number(Math.hypot(b.uv[0] - a.uv[0], b.uv[1] - a.uv[1]))} mm`
}

/** The distance from `p` to the segment `a` to `b`. */
function toSegment(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/**
 * Whether `uv` is within `reach` mm of the outline: of any loop of the cut. A free click there is on the model's own line, freehand; one
 * away from it, over the photo, is on the photo.
 */
export function onOutline(cut: { parts: ReadonlyArray<{ loops: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number]>; closed?: boolean }> }> }, uv: readonly [number, number], reach: number): boolean {
  for (const part of cut.parts) {
    for (const loop of part.loops) {
      const n = loop.points.length
      for (let i = 0; i < (loop.closed === false ? n - 1 : n); i++) if (toSegment(uv, loop.points[i], loop.points[(i + 1) % n]) <= reach) return true
    }
  }
  return false
}

export class MeasureTool {
  private from: SpanEndDraft | null = null

  /** `finish` gets both ends, once for each span; `changed` is told when what waits has changed. */
  constructor(
    private readonly finish: (a: SpanEndDraft, b: SpanEndDraft) => void,
    private readonly changed: () => void = () => {}
  ) {}

  /** The first end, once it is clicked; null otherwise. */
  get draft(): SpanEndDraft | null {
    return this.from
  }

  get active(): boolean {
    return this.from !== null
  }

  /** A click: the first end of a span, then its second, which makes it. A second click on the first point makes nothing (a span of no length). */
  click(at: MeasureClick): void {
    if (!Number.isFinite(at.uv[0]) || !Number.isFinite(at.uv[1])) return
    const end = endOf(at)
    if (this.from === null) {
      this.from = end
      this.changed()
      return
    }
    if (end.uv[0] === this.from.uv[0] && end.uv[1] === this.from.uv[1]) return
    const first = this.from
    this.from = null
    this.changed()
    this.finish(first, end)
  }

  /** Esc: the first end given up. True when there was one. */
  cancel(): boolean {
    if (this.from === null) return false
    this.from = null
    this.changed()
    return true
  }

  /** What the number reads while the pointer is at `to`; nothing before the first end. */
  readout(to: MeasureClick | null): string {
    return this.from === null || to === null ? '' : spanReadout(this.from, endOf(to))
  }

  /** The line so far as elements of the draft layer in the sheet's own millimetres (`down` says whether the plane's v runs down the screen). */
  elements(to: readonly [number, number] | null, down: boolean, pxPerMm: number): string {
    if (this.from === null) return ''
    const at = (p: readonly [number, number]): [string, string] => [mm(p[0]), mm(down ? p[1] : -p[1])]
    const [x1, y1] = at(this.from.uv)
    const out = [`<circle class="tr-draft-at" cx="${x1}" cy="${y1}" r="${mm(3 / pxPerMm)}"/>`]
    if (to !== null) {
      const [x2, y2] = at(to)
      out.push(`<line class="tr-measure" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
    }
    return out.join('')
  }
}
