import { MAX_NOTE, type NewMark } from '../../../shared/marks'
import { type Tracing, toObject } from '../../../shared/tracings'
import type { Camera } from '../../../shared/view'
import type { Click } from './traceTool'

// The Pin tool's own state, apart from the screen: the point the person clicked, which waits for its note (typed where the point is),
// and what Enter, Esc and a blur do to it. A note typed makes the pin (`finish`); a note left empty, or Esc, lets the point go and
// makes nothing. Nothing here is held in React: the sheet draws the waiting point from `elements` onto the draft layer.

/** A free click is kept to a ten thousandth of a millimetre; a snapped point is the kernel's, in full (as the Trace tool keeps them). */
const free = (n: number): number => Math.round(n * 1e4) / 1e4 + 0
const mm = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)

export class PinTool {
  private at: [number, number] | null = null
  private snapped = false

  /** `finish` gets the point (`[u, v]` in mm), whether it was snapped, and the note, once for each pin; `changed` is told when what waits has changed. */
  constructor(
    private readonly finish: (uv: [number, number], snapped: boolean, note: string) => void,
    private readonly changed: () => void = () => {}
  ) {}

  /** Where the note waits to be typed, in the plane's `[u, v]`, or null. */
  get draft(): [number, number] | null {
    return this.at
  }

  get active(): boolean {
    return this.at !== null
  }

  /** A click on the sheet: the point whose note is asked for. Another click moves it. */
  click(at: Click): void {
    const uv: [number, number] = at.snapped ? [at.uv[0], at.uv[1]] : [free(at.uv[0]), free(at.uv[1])]
    if (!Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) return
    this.at = uv
    this.snapped = at.snapped
    this.changed()
  }

  /** The note, typed: one line, trimmed, at most `MAX_NOTE` characters. With none, the point is let go and no pin is made. True when one was. */
  text(value: string): boolean {
    const at = this.at
    if (at === null) return false
    const snapped = this.snapped
    const note = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE)
    this.at = null
    this.changed()
    if (note === '') return false
    this.finish([at[0], at[1]], snapped, note)
    return true
  }

  /** Esc: the waiting point given up. True when there was one. */
  cancel(): boolean {
    if (this.at === null) return false
    this.at = null
    this.changed()
    return true
  }

  /** The waiting point as a ring in the sheet's own millimetres (`down` says whether the plane's v runs down the screen). */
  elements(down: boolean, pxPerMm: number): string {
    if (this.at === null) return ''
    const [x, y] = [this.at[0], down ? this.at[1] : -this.at[1]]
    return `<circle class="tr-draft-at" cx="${mm(x)}" cy="${mm(y)}" r="${mm(3 / pxPerMm)}"/>`
  }
}

/** Where a mark is placed from: the project, layout and build on show, and the view's camera. */
export interface Placed {
  objectId: string
  layout: string
  revision: number
  camera: Camera
}

/**
 * The pin of the person's at `uv` of `tracing`: a point of its plane in the object frame, with no part (main ties it to the face under it
 * when it is on the outline, `placeOnTracing`), made on the build and from the view on show. Main works out its `uv` and checks it.
 */
export function pinMark(tracing: Pick<Tracing, 'id' | 'layout' | 'plane'>, uv: readonly [number, number], note: string, placed: Omit<Placed, 'objectId'> & { objectId?: string }): NewMark {
  return { kind: 'pin', author: 'user', note, layout: tracing.layout, revision: placed.revision, camera: placed.camera, anchor: { point: toObject(tracing.plane, uv) }, tracing: tracing.id }
}
