import { type LayerShape, OFFSET_STEP_MM, offsetWords, referencePoint, shapeMoved } from '../../../shared/tracings'

// The Should be here tool's own state, apart from the screen: a shape of a layer grabbed with the pointer and dragged to where it
// belongs. While it is dragged the sheet shows the shape ghosted where it was, the moved copy in the person's colour and a readout at the
// pointer (`M15 head bolt 4 should be here · 1.8 mm left, 0.6 mm up`); Shift keeps the drag to one axis and the arrow keys nudge it 0.1 mm.
// Releasing makes the mark (`finish`: one for each drag; dragging the same shape again changes the person's draft, which main does). The
// arrow keys go on nudging the shape just placed until another is grabbed. Nothing here is held in React.

const mm = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)
/** A drag is kept to a ten thousandth of a millimetre, so that a nudge adds a tenth and no float dust. */
const tidy = (n: number): number => Math.round(n * 1e4) / 1e4 + 0

type Uv = readonly [number, number]

/** The shape under the pointer when it was pressed: its layer's id and name, its place in the layer, and the shape as it is. */
export interface Grabbed {
  layer: number
  layerName: string
  index: number
  shape: LayerShape
}

/** How a shape is told while it is dragged: its name, or `shape 4 of head bolts` when it has none. */
export function shapeLabel(g: Pick<Grabbed, 'layerName' | 'index' | 'shape'>): string {
  const name = g.shape.kind === 'label' ? '' : (g.shape.name ?? '')
  return name === '' ? `shape ${g.index + 1} of ${g.layerName}` : name
}

/** The shape as elements of the draft layer in the sheet's own millimetres (`down` says whether the plane's v runs down the screen). */
export function shapeElements(shape: LayerShape, down: boolean, pxPerMm: number, cls: string): string {
  const at = (p: Uv): [string, string] => [mm(p[0]), mm(down ? p[1] : -p[1])]
  if (shape.kind === 'circle') {
    const [x, y] = at(shape.centre)
    return `<circle class="${cls}" cx="${x}" cy="${y}" r="${mm(shape.radius)}" fill="none"/>`
  }
  if (shape.kind === 'label') {
    const [x, y] = at(shape.at)
    return `<circle class="${cls}" cx="${x}" cy="${y}" r="${mm(4 / pxPerMm)}" fill="none"/>`
  }
  return `<path class="${cls}" d="M${shape.points.map((p) => at(p).join(' ')).join(' L')}${shape.closed ? ' Z' : ''}" fill="none"/>`
}

export class OffsetTool {
  /** The shape in hand, where the pointer pressed and how far it has been dragged. `down` is whether the pointer is still down. */
  private hand: (Grabbed & { start: [number, number]; by: [number, number]; adjust: [number, number]; down: boolean }) | null = null

  /**
   * `finish` gets the layer, the shape's place in it and how far it was dragged `[du, dv]`, once for each release and each nudge after it.
   * `idOf` says the mark the person already made of a shape of a layer (`M15`), for the readout; `changed` is told when what is drawn has.
   */
  constructor(
    private readonly finish: (layer: number, index: number, by: [number, number]) => void,
    private readonly changed: () => void = () => {},
    private readonly idOf: (layer: number, index: number) => string | undefined = () => undefined
  ) {}

  get dragging(): boolean {
    return this.hand?.down === true
  }

  /** A shape is in hand: being dragged, or just placed and still nudged by the arrow keys. */
  get active(): boolean {
    return this.hand !== null
  }

  /** The pointer pressed on `shape` at `uv`: the drag begins, with no move yet. Another press lets the one placed before go. */
  press(grabbed: Grabbed, uv: Uv): void {
    if (!Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) return
    this.hand = { ...grabbed, start: [uv[0], uv[1]], by: [0, 0], adjust: [0, 0], down: true }
    this.changed()
  }

  /** How far the pointer has moved from where it pressed, plus what the arrow keys added; with `shift` along the one axis it has moved further on. */
  private moveTo(uv: Uv, shift: boolean): [number, number] {
    const hand = this.hand!
    let [du, dv] = [uv[0] - hand.start[0], uv[1] - hand.start[1]]
    if (shift) {
      if (Math.abs(du) >= Math.abs(dv)) dv = 0
      else du = 0
    }
    return [tidy(du + hand.adjust[0]), tidy(dv + hand.adjust[1])]
  }

  /** The pointer moved: the shape follows. */
  move(uv: Uv, shift = false): void {
    if (this.hand?.down !== true || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) return
    this.hand.by = this.moveTo(uv, shift)
    this.changed()
  }

  /** The pointer was let go: the mark is made, unless the shape was dragged nowhere. The shape stays in hand for the arrow keys. */
  release(uv: Uv, shift = false): void {
    const hand = this.hand
    if (hand?.down !== true) return
    if (Number.isFinite(uv[0]) && Number.isFinite(uv[1])) hand.by = this.moveTo(uv, shift)
    hand.down = false
    // What was dragged is now the shape's own: a nudge adds to it.
    hand.adjust = [hand.by[0], hand.by[1]]
    hand.start = [uv[0], uv[1]]
    this.changed()
    if (hand.by[0] === 0 && hand.by[1] === 0) {
      this.hand = null
      this.changed()
      return
    }
    this.finish(hand.layer, hand.index, [hand.by[0], hand.by[1]])
  }

  /**
   * An arrow key, by its place in the row (`which`: left, right, up, down): the shape in hand moves 0.1 mm, along `-u`, `+u`, `+v`, `-v`.
   * While it is being dragged only what is drawn changes; once placed the mark is made again with the new distance. True when a shape was
   * in hand.
   */
  nudge(arrow: 0 | 1 | 2 | 3): boolean {
    const hand = this.hand
    if (hand === null) return false
    const step: [number, number] = arrow === 0 ? [-OFFSET_STEP_MM, 0] : arrow === 1 ? [OFFSET_STEP_MM, 0] : arrow === 2 ? [0, OFFSET_STEP_MM] : [0, -OFFSET_STEP_MM]
    hand.by = [tidy(hand.by[0] + step[0]), tidy(hand.by[1] + step[1])]
    hand.adjust = [tidy(hand.adjust[0] + step[0]), tidy(hand.adjust[1] + step[1])]
    this.changed()
    if (!hand.down) {
      if (hand.by[0] === 0 && hand.by[1] === 0) this.hand = null
      else this.finish(hand.layer, hand.index, [hand.by[0], hand.by[1]])
    }
    return true
  }

  /** Esc: the shape in hand is let go, and what was dragged and not yet released is given up. True when there was one. */
  cancel(): boolean {
    if (this.hand === null) return false
    this.hand = null
    this.changed()
    return true
  }

  /** The readout at the pointer, `M15 head bolt 4 should be here · 1.8 mm left, 0.6 mm up`; the mark's number once the shape has one. Nothing with no shape in hand. */
  readout(): string {
    const hand = this.hand
    if (hand === null) return ''
    const id = this.idOf(hand.layer, hand.index)
    return `${id === undefined ? '' : `${id} `}${shapeLabel(hand)} should be here · ${offsetWords(hand.by)}`
  }

  /**
   * The shape ghosted where it was, the moved copy and an arrow between their reference points, as elements of the draft layer, while the
   * pointer drags it. Once it is let go the mark is drawn by the sheet from what main kept, and nothing is drawn twice.
   */
  elements(down: boolean, pxPerMm: number): string {
    const hand = this.hand
    if (hand === null || !hand.down) return ''
    const moved = shapeMoved(hand.shape, hand.by)
    const [from, to] = [referencePoint(hand.shape), referencePoint(moved)]
    const at = (p: Uv): [string, string] => [mm(p[0]), mm(down ? p[1] : -p[1])]
    const [x1, y1] = at(from)
    const [x2, y2] = at(to)
    const out = [shapeElements(hand.shape, down, pxPerMm, 'tr-offset-ghost'), shapeElements(moved, down, pxPerMm, 'tr-offset-moved')]
    if (hand.by[0] !== 0 || hand.by[1] !== 0) out.push(`<line class="tr-offset-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
    return out.join('')
  }
}
