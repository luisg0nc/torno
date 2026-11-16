// The camera of the board: where the layer of cards stands in the element it sits in, and how large. A plain class: it
// writes the layer's transform itself and tells its listener (the minimap's box), and nothing of it goes through React,
// so that panning and zooming render no card.

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
/** The room `fit` leaves around what it shows, in pixels of the element. */
export const FIT_MARGIN = 48

export interface View {
  /** Where board (0, 0) is, in pixels from the element's corner. */
  x: number
  y: number
  /** Pixels of the element for one unit of the board: 1 is 100 %. */
  k: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const clamp = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

export class Camera {
  private x = 0
  private y = 0
  private k = 1

  /** `layer` is moved inside its parent, whose corner and size are the screen the board is seen through. */
  constructor(
    private readonly layer: HTMLElement,
    private readonly onChange: () => void
  ) {}

  get view(): View {
    return { x: this.x, y: this.y, k: this.k }
  }

  private rect(): { left: number; top: number; width: number; height: number } {
    return this.layer.parentElement?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 }
  }

  private readonly listeners = new Set<() => void>()

  /** Also tells `listener` after every change (the minimap's box); returns what stops it. */
  listen(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private apply(): void {
    this.layer.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.k})`
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

  /** Moves the board by pixels of the screen. */
  pan(dx: number, dy: number): void {
    this.x += dx
    this.y += dy
    this.apply()
  }

  /** Zooms by `factor` about a point of the page, which keeps what is under it. The result is held between 10 % and 400 %. */
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

  /** Shows the whole of `box`, centred, no larger than 100 %. */
  fit(box: Box): void {
    const r = this.rect()
    const room = (side: number, of: number): number => (of > 0 ? Math.max(1, side - 2 * FIT_MARGIN) / of : Infinity)
    this.k = clamp(Math.min(1, room(r.width, box.w), room(r.height, box.h)))
    this.x = r.width / 2 - (box.x + box.w / 2) * this.k
    this.y = r.height / 2 - (box.y + box.h / 2) * this.k
    this.apply()
  }

  /** Moves the board so that a point of it is in the middle of the screen. */
  centreOn(bx: number, by: number): void {
    const r = this.rect()
    this.x = r.width / 2 - bx * this.k
    this.y = r.height / 2 - by * this.k
    this.apply()
  }

  /** The board point under a point of the page. */
  toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.rect()
    return { x: (clientX - r.left - this.x) / this.k, y: (clientY - r.top - this.y) / this.k }
  }

  /** The part of the board the screen shows now. */
  visible(): Box {
    const r = this.rect()
    return { x: -this.x / this.k, y: -this.y / this.k, w: r.width / this.k, h: r.height / this.k }
  }
}
