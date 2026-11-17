import { Sheet, type View } from './Sheet'

// One of the two panes of the line-up: a sheet (the photo in its pixels, or the tracing in its millimetres) that pans and zooms by itself, takes
// a click, and draws the numbered markers of the clicks made on it. Everything it does is written on the elements and told by callbacks: no
// state of React moves with the pointer. The photo's pane has its y down, as the photo has; the tracing's has `v` up, as a photo of its plane's
// front sees it (`LineUp.tsx`).

/** How many pixels a press may move and still be a click. */
const CLICK_SLOP = 4
/** The radius of a marker's ring, in screen pixels. */
const RING = 7

export interface Marker {
  /** In the pane's own coordinates: photo pixels, or `[u, v]`. */
  at: readonly [number, number]
  /** Its number, `1`, `2`, … */
  label: string
  /** The class that gives it its colour. */
  className: string
}

export interface PaneEvents {
  /** A click on empty space, in the pane's own coordinates. */
  click(at: [number, number], e: PointerEvent): void
  /** The pointer over the pane, or leaving it (null). */
  hover(at: [number, number] | null, e: PointerEvent | null): void
  /** A marker moved by dragging. */
  drag(i: number, at: [number, number], e: PointerEvent): void
  /** A marker let go. */
  drop(i: number): void
}

const wheelPixels = (e: WheelEvent): number => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
const round = (n: number): number => Math.round(n * 1000) / 1000 + 0

export class LineupPane {
  readonly sheet: Sheet
  private press: { x: number; y: number; from: { x: number; y: number }; marker: number | null; moved: boolean } | null = null
  private readonly off: Array<() => void> = []

  /**
   * `layer` is the element the sheet moves (its parent is the screen), `markers` the svg inside it that the markers are written into, `down`
   * whether the pane's second coordinate runs down the screen (the photo's) or up (the tracing's `v`).
   */
  constructor(
    private readonly stage: HTMLElement,
    layer: HTMLElement,
    private readonly markers: SVGSVGElement,
    private readonly events: PaneEvents,
    private readonly down: boolean,
    onChange: (view: View) => void
  ) {
    this.sheet = new Sheet(layer, () => onChange(this.sheet.view))
    this.sheet.setDown(down)
    const listen = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
      stage.addEventListener(type, fn as EventListener, options)
      this.off.push(() => stage.removeEventListener(type, fn as EventListener, options))
    }
    listen('wheel', this.onWheel, { passive: false })
    listen('pointerdown', this.onDown)
    listen('pointermove', this.onMove)
    listen('pointerup', this.onUp)
    listen('pointercancel', this.onUp)
    listen('pointerleave', (e) => {
      if (this.press === null) this.events.hover(null, e)
    })
    listen('contextmenu', (e) => e.preventDefault())
  }

  dispose(): void {
    for (const off of this.off) off()
    this.off.length = 0
  }

  /** The point of the pane under the pointer. */
  private at(e: { clientX: number; clientY: number }): [number, number] {
    return this.sheet.toUv(e.clientX, e.clientY)
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const unit = wheelPixels(e)
    if (e.ctrlKey) this.sheet.zoomAt(Math.exp((-e.deltaY * unit) / 500), e.clientX, e.clientY)
    else this.sheet.pan(-e.deltaX * unit, -e.deltaY * unit)
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button > 2) return
    this.stage.focus({ preventScroll: true })
    e.preventDefault()
    const hit = e.button === 0 && e.target instanceof Element ? e.target.closest<SVGElement>('[data-i]') : null
    const marker = hit === null ? null : Number(hit.dataset.i)
    this.press = { x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY }, marker: marker !== null && Number.isInteger(marker) ? marker : null, moved: false }
    this.stage.setPointerCapture(e.pointerId)
  }

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.press
    if (p === null) return this.events.hover(this.at(e), e)
    if (p.marker !== null) {
      p.moved = true
      return this.events.drag(p.marker, this.at(e), e)
    }
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.from.x, e.clientY - p.from.y) < CLICK_SLOP) return
      p.moved = true
    }
    this.stage.setAttribute('data-panning', '')
    this.sheet.pan(e.clientX - p.x, e.clientY - p.y)
    p.x = e.clientX
    p.y = e.clientY
  }

  private readonly onUp = (e: PointerEvent): void => {
    const p = this.press
    if (p === null) return
    this.press = null
    this.stage.removeAttribute('data-panning')
    if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId)
    if (p.marker !== null) return this.events.drop(p.marker)
    if (e.type === 'pointerup' && e.button === 0 && !p.moved) this.events.click(this.at(e), e)
  }

  /**
   * Writes the markers, and a ring where a click would snap (`snap`), on the pane: each marker's ring is `RING` pixels whatever the zoom, its
   * number beside it. `ringClass` styles the snap ring (a projected vertex is fainter).
   */
  paint(list: readonly Marker[], snap?: { at: readonly [number, number]; className: string } | null): void {
    const k = this.sheet.view.k
    const place = (at: readonly [number, number]): [number, number] => [round(at[0]), round(this.down ? at[1] : -at[1])]
    const r = RING / k
    const mark = (m: Marker, i: number): string => {
      const [x, y] = place(m.at)
      return (
        `<g class="lu-marker ${m.className}" data-i="${i}" transform="translate(${x} ${y})">` +
        `<circle class="lu-hit" r="${round(r * 1.8)}"/>` +
        `<circle class="lu-ring" r="${round(r)}"/>` +
        `<path class="lu-cross" d="M${round(-r * 1.7)} 0H${round(r * 1.7)}M0 ${round(-r * 1.7)}V${round(r * 1.7)}"/>` +
        `<text class="lu-number" x="${round(r * 1.3)}" y="${round(-r * 1.1)}" font-size="${round(12 / k)}">${m.label}</text>` +
        `</g>`
      )
    }
    let out = list.map(mark).join('')
    if (snap) {
      const [x, y] = place(snap.at)
      out += `<circle class="tr-snap ${snap.className}" cx="${x}" cy="${y}" r="${round((RING + 3) / k)}"/>`
    }
    this.markers.innerHTML = out
  }
}
