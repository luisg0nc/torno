import { number } from '../../../shared/format'

// The sheet of a tracing: where the drawing of the plane stands in the element it sits in, and how large. A plain class, as the
// board's camera is: it writes the layer's transform itself and tells its listener (the readouts), and nothing of it goes
// through React, so that panning and zooming draw nothing again (`__tornoTracingRenders` counts the draws, under test).
//
// The layer holds the drawing in millimetres from the plane's origin, `y` down the screen (`tracingSvg` with `forScreen`), so its
// scale is pixels for a millimetre. 1:1 is one CSS millimetre for a millimetre: screens do not say their real pixel size, and
// a CSS millimetre is the one every other thing on the page is measured in.

/** CSS pixels in one CSS millimetre. */
export const PX_PER_MM = 96 / 25.4
/** The least and the greatest zoom, as a ratio: 1:50 to 400:1. */
export const MIN_RATIO = 0.02
export const MAX_RATIO = 400
/** The room `fit` leaves round what it shows, in pixels of the element. */
export const FIT_MARGIN = 48

export interface View {
  /** Where the plane's origin is, in pixels from the element's corner. */
  x: number
  y: number
  /** Pixels of the element for one millimetre. */
  k: number
}

/** `[x, y, width, height]` in the layer's millimetres: what `tracingSvg` calls the box of what is drawn. */
export type SheetBox = readonly [number, number, number, number]

const clamp = (k: number): number => Math.min(MAX_RATIO * PX_PER_MM, Math.max(MIN_RATIO * PX_PER_MM, k))

/** How a zoom is told: `1:1`, `4:1` enlarged and `1:4` reduced. */
export function ratioText(ratio: number): string {
  return ratio >= 1 ? `${number(ratio)}:1` : `1:${number(1 / ratio)}`
}

/** The axis of the object frame a unit vector runs along (`x`, `y`, `z`), or null for a plane that is not square to one: the sheet draws `u = 0` and `v = 0` in that axis's colour. */
export function axisOfDirection(direction: readonly [number, number, number]): 'x' | 'y' | 'z' | null {
  const at = direction.findIndex((c) => Math.abs(c) > 1 - 1e-6)
  return at < 0 ? null : (['x', 'y', 'z'] as const)[at]
}

/** Counts a draw of the layer under test (the test page asks for it with `?test`): a pan or a zoom must not add one. */
export function countRender(): void {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test') && typeof window !== 'undefined') window.__tornoTracingRenders = (window.__tornoTracingRenders ?? 0) + 1
}

export class Sheet {
  private x = 0
  private y = 0
  private k = PX_PER_MM
  private box: SheetBox | null = null
  private down = false
  private readonly listeners = new Set<() => void>()

  /** `layer` is moved inside its parent, whose corner and size are the screen the sheet is seen through. */
  constructor(
    private readonly layer: HTMLElement | SVGElement,
    private readonly onChange: () => void
  ) {}

  get view(): View {
    return { x: this.x, y: this.y, k: this.k }
  }

  /** The zoom as a ratio: 1 is 1:1, one CSS millimetre for a millimetre. */
  zoomRatio(): number {
    return this.k / PX_PER_MM
  }

  /** What `fit` frames: the box of what is drawn, or null for none. */
  setBox(box: SheetBox | null): void {
    this.box = box
  }

  /** Whether the plane's `v` runs down the screen (`tracingSvg`'s `down`): `toUv` and `toScreen` go by it. */
  setDown(down: boolean): void {
    this.down = down
  }

  private rect(): { left: number; top: number; width: number; height: number } {
    return this.layer.parentElement?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 }
  }

  /** Also tells `listener` after every change; returns what stops it. */
  listen(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private apply(): void {
    ;(this.layer as HTMLElement).style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.k})`
    this.onChange()
    for (const listener of this.listeners) listener()
  }

  /** Tells the listener where the sheet stands, with no change: for what has come into the page since. */
  refresh(): void {
    this.onChange()
    for (const listener of this.listeners) listener()
  }

  /** Stands where `view` says, as it was left. */
  restore(view: View): void {
    this.x = view.x
    this.y = view.y
    this.k = clamp(view.k)
    this.apply()
  }

  /** Moves the sheet by pixels of the screen. */
  pan(dx: number, dy: number): void {
    this.x += dx
    this.y += dy
    this.apply()
  }

  /** Zooms by `factor` about a point of the page, which keeps what is under it. The result is held between 1:50 and 400:1. */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const r = this.rect()
    const px = clientX - r.left
    const py = clientY - r.top
    const k = clamp(this.k * factor)
    this.x = px - ((px - this.x) / this.k) * k
    this.y = py - ((py - this.y) / this.k) * k
    this.k = k
    this.apply()
  }

  /** Shows the whole of the box with a margin round it, centred, as large as the screen allows. With no box, 1:1 with the origin in the middle. */
  fit(): void {
    const r = this.rect()
    if (this.box === null) {
      this.k = PX_PER_MM
      this.x = r.width / 2
      this.y = r.height / 2
      return this.apply()
    }
    const [bx, by, bw, bh] = this.box
    const room = (side: number, of: number): number => (of > 0 ? Math.max(1, side - 2 * FIT_MARGIN) / of : Infinity)
    this.k = clamp(Math.min(room(r.width, bw), room(r.height, bh)))
    this.x = r.width / 2 - (bx + bw / 2) * this.k
    this.y = r.height / 2 - (by + bh / 2) * this.k
    this.apply()
  }

  /** Sets 1:1 about the middle of the screen: what is there stays there. */
  actual(): void {
    const r = this.rect()
    const px = r.width / 2
    const py = r.height / 2
    this.x = px - ((px - this.x) / this.k) * PX_PER_MM
    this.y = py - ((py - this.y) / this.k) * PX_PER_MM
    this.k = PX_PER_MM
    this.apply()
  }

  /** The point of the plane, `[u, v]` in mm, under a point of the page. */
  toUv(clientX: number, clientY: number): [number, number] {
    const r = this.rect()
    const u = (clientX - r.left - this.x) / this.k
    const y = (clientY - r.top - this.y) / this.k
    return [u + 0, (this.down ? y : -y) + 0]
  }

  /** Where a point of the plane is on the page. */
  toScreen(uv: readonly [number, number]): [number, number] {
    const r = this.rect()
    return [r.left + this.x + uv[0] * this.k, r.top + this.y + (this.down ? uv[1] : -uv[1]) * this.k]
  }
}
