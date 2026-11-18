import * as THREE from 'three'
import { NO_VALUE, offBy, shownDimension } from '../../../shared/dimension'
import { number } from '../../../shared/format'
import { type DimensionMark, type Mark, type RegionMark, type ShapeIntent, type ReviewIntent, type SpanMark, type Vec3, markIntent } from '../../../shared/marks'
import { INTENT_CHIP, INTENT_SIGN } from '../../../shared/reviews'
import { LEADER_PX, labelAnchor } from './markObjects'

export interface Size {
  width: number
  height: number
}

/** A mark's label in a view: where it hangs, in pixels from the top left, and whether it is in the picture at all. */
export interface Label {
  id: string
  /** `M3`, with `~` for an anchor that drifted and `?` for one that was lost. */
  text: string
  /** What the person says of the mark, for the round disc beside the chip: `-` for what they do not want, `+` for what they want; none for any other mark. */
  sign?: '-' | '+'
  author: Mark['author']
  x: number
  y: number
  /** False behind the camera and outside the frame. */
  visible: boolean
  /** The way the chip leans off its point, on screen (unit, y down), and how far it stands off, in pixels. */
  lean: [number, number]
  gap: number
  /** Of a dimension: its value as it is written beside its number (`⌀ 8 mm`, or `—` for none), and whether that is what was expected, when something was. */
  value?: LabelValue
}

export interface LabelValue {
  text: string
  verdict?: 'pass' | 'fail'
  /** Of one that fails: by how much it misses, and which way (`2 under`, `offBy`). */
  off?: string
  /** The value is of another build than the one drawn: it is written faint, and has no verdict. */
  stale?: true
}

/**
 * A dimension's value as its chip writes it on the build `revision`, by the
 * rule of its row (`shownDimension`): the value measured on that build, with
 * its verdict; the last one it had, with the build it is of after it
 * (`6 mm (r11)`) and marked stale, when it has not been measured on that
 * build; `—` when it has none, or only one its file holds from a run before. One that fails says by how much it
 * misses (`off`), as its row does. The same on screen and in a picture for the
 * agent, where a value that was only fainter would be read as the part's.
 */
export function labelValue(mark: DimensionMark, revision: number | undefined): LabelValue {
  const shown = shownDimension(mark, revision)
  if (shown.value !== undefined) {
    const off = shown.verdict === 'fail' && mark.expected !== undefined ? { off: offBy(shown.value, mark.expected) } : {}
    return { text: shown.text, ...(shown.verdict ? { verdict: shown.verdict } : {}), ...off }
  }
  if (!shown.stale) return { text: NO_VALUE }
  return { text: `${shown.text} (${shown.of === undefined ? 'earlier' : `r${shown.of}`})`, stale: true }
}

/** A span's value as its chip writes it: `≈ 41.8 mm`, with `≈` unless both its ends were the kernel's points. It has no verdict, and is never of another build. */
export function spanValue(mark: Pick<SpanMark, 'value' | 'exact'>): LabelValue {
  return { text: `${mark.exact ? '' : '≈ '}${number(mark.value)} mm` }
}

/** How large the chip of a label is: of its text and, for a dimension, its value beside it. */
export type Chip = (text: string, value?: LabelValue, sign?: Label['sign']) => { w: number; h: number }

/** A label with the box of its chip, top left and size in pixels. */
export interface Placed extends Label {
  box: { x: number; y: number; w: number; h: number }
}

/** Up and to the right: where a chip sits when nothing says otherwise. */
const DEFAULT_LEAN: [number, number] = [Math.SQRT1_2, -Math.SQRT1_2]
const GAP_PX = 9
/** The least a chip stands off its mark's point, so that it does not cover it. */
const CLEAR_PX = 7
/** Room kept between two chips, and around the point of another mark. */
const SPACING_PX = 3
const POINT_PX = 5
const TURNS = [0, 45, -45, 90, -90, 135, -135, 180].map((d) => (d * Math.PI) / 180)
const RINGS = 5

/**
 * Whether bringing a selected mark into view moves the camera to the view it was placed from: only when its label
 * is not in view now. One that is not drawn (null: resolved, on a part switched off) has no place on screen but there.
 */
export function needsCamera(label: Pick<Label, 'visible'> | null): boolean {
  return label?.visible !== true
}

/** What a mark carries of who made it and what the person says of it: enough to tell `− M8` from `M8`. */
type Said = Pick<Mark, 'id' | 'anchorState'> & Partial<Pick<Mark, 'author' | 'kind'>> & { intent?: ShapeIntent | ReviewIntent }

/** `− ` or `+ ` before a mark's number when the person says they do not want it or want it, nothing for any other mark (the agent's never). */
function said(mark: Said): string {
  const intent = mark.author === undefined || mark.kind === undefined ? null : markIntent({ author: mark.author, kind: mark.kind, intent: mark.intent })
  return intent === null ? '' : `${INTENT_CHIP[intent]} `
}

/** The round sign of a mark the person says they do not want or want, as the disc beside its chip writes it; none for any other mark (the agent's never). */
export function signOf(mark: Said): Label['sign'] | undefined {
  const intent = mark.author === undefined || mark.kind === undefined ? null : markIntent({ author: mark.author, kind: mark.kind, intent: mark.intent })
  return intent === null ? undefined : INTENT_SIGN[intent]
}

/** What a chip in the view carries: the number, with `~` for an anchor that drifted and `?` for one that was lost. Its sign is the disc's (`signOf`). */
export function chipText(mark: Said): string {
  return mark.id + (mark.anchorState === 'drifted' ? '~' : mark.anchorState === 'orphaned' ? '?' : '')
}

/** What a mark is called as a line of words: its sign, then the number (the chip of the view has the sign as a disc beside it, `chipText`). */
export function labelText(mark: Said): string {
  return said(mark) + mark.id + (mark.anchorState === 'drifted' ? '~' : mark.anchorState === 'orphaned' ? '?' : '')
}

/** What a mark is called in its row: the row says in words what the last build did to it, so its chip is the number alone, with what the person says of it. */
export function rowLabel(mark: Said): string {
  return said(mark) + mark.id
}

/**
 * How many millimetres one pixel is at a point, for a camera whose matrices
 * are up to date and a picture `heightPx` high.
 */
export function mmPerPx(camera: THREE.Camera, point: THREE.Vector3, heightPx: number): number {
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const c = camera as THREE.OrthographicCamera
    return (c.top - c.bottom) / c.zoom / heightPx
  }
  const c = camera as THREE.PerspectiveCamera
  const depth = -point.clone().applyMatrix4(c.matrixWorldInverse).z
  return (2 * Math.max(depth, 1e-6) * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2)) / c.zoom / heightPx
}

/**
 * Where the labels of some marks fall in a view. `camera` is the one the view
 * is drawn with, its matrices up to date; `size` is the view in pixels; `unit`
 * is how many of those a nominal pixel is (see `rescale`); `revision` is the
 * build drawn, which a dimension's value is of or is not (`labelValue`).
 * `regionAt` says where the middle of a region of a scan is in that view, and
 * `movedBy` how far from where it is a mark is drawn (with its part, while
 * the parts are drawn apart).
 * Pure: the same for the screen and for a picture.
 */
export function project(marks: Mark[], camera: THREE.Camera, size: Size, unit = 1, revision?: number, regionAt?: (mark: RegionMark) => Vec3 | null, movedBy?: (mark: Mark) => Vec3): Label[] {
  const toPx = (p: THREE.Vector3): { x: number; y: number; visible: boolean } => {
    const inFront = p.clone().applyMatrix4(camera.matrixWorldInverse).z < 0 || (camera as THREE.OrthographicCamera).isOrthographicCamera === true
    const v = p.clone().project(camera)
    const inside = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1
    return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, visible: inFront && inside }
  }
  return marks.flatMap((mark): Label[] => {
    // A note whose ink lay over no face hangs no label: it is a picture, in no place of the model.
    if (mark.kind === 'note' && !mark.anchor) return []
    const anchor = labelAnchor(mark, regionAt)
    const point = new THREE.Vector3().fromArray(anchor.point)
    if (movedBy) point.add(new THREE.Vector3().fromArray(movedBy(mark)))
    const sign = signOf(mark)
    const base: Pick<Label, 'id' | 'text' | 'author' | 'value' | 'sign'> = { id: mark.id, text: chipText(mark), author: mark.author, ...(sign ? { sign } : {}) }
    if (mark.kind === 'dimension') base.value = labelValue(mark, revision)
    else if (mark.kind === 'span') base.value = spanValue(mark)
    const foot = toPx(point)
    if (!anchor.leader) return [{ ...base, ...foot, lean: DEFAULT_LEAN, gap: GAP_PX * unit }]

    // A pin's label hangs at the end of its leader, and leans the way the leader runs on screen: so does that of whatever else has one.
    const reach = (anchor.reach ?? LEADER_PX) * unit * mmPerPx(camera, point, size.height)
    const end = toPx(point.clone().addScaledVector(new THREE.Vector3().fromArray(anchor.leader), reach))
    const run = Math.hypot(end.x - foot.x, end.y - foot.y)
    // Seen end on, the leader is a point: the chip goes above the pin, clear of its dot.
    const lean: [number, number] = run > 2 * unit ? [(end.x - foot.x) / run, (end.y - foot.y) / run] : [0, -1]
    return [{ ...base, x: end.x, y: end.y, visible: foot.visible, lean, gap: Math.max(2 * unit, CLEAR_PX * unit - run) }]
  })
}

/**
 * Gives every visible label a chip that covers no other chip and no other
 * mark's point: each leans the way it asks to, and failing that is turned
 * about its point, then moved further out. `chip` says how large the chip of a
 * text is. Labels are placed in the order given, so the first keeps its place.
 */
export function place(labels: Label[], chip: Chip, size: Size, unit = 1): Placed[] {
  const placed: Placed[] = []
  const pad = SPACING_PX * unit
  const points = labels.filter((l) => l.visible)
  for (const label of labels) {
    const { w, h } = chip(label.text, label.value, label.sign)
    const boxAt = (turn: number, ring: number): Placed['box'] => {
      const dx = label.lean[0] * Math.cos(turn) - label.lean[1] * Math.sin(turn)
      const dy = label.lean[0] * Math.sin(turn) + label.lean[1] * Math.cos(turn)
      // Far enough along the lean that the chip's box just clears its point.
      const reach = label.gap + ring * (h + pad) + (Math.abs(dx) * w) / 2 + (Math.abs(dy) * h) / 2
      return { x: label.x + dx * reach - w / 2, y: label.y + dy * reach - h / 2, w, h }
    }
    let box = boxAt(0, 0)
    if (label.visible) {
      const free = (b: Placed['box'], within: boolean): boolean =>
        (!within || (b.x >= 0 && b.y >= 0 && b.x + b.w <= size.width && b.y + b.h <= size.height)) &&
        placed.every((other) => !other.visible || !overlaps(b, other.box, pad)) &&
        points.every((other) => other === label || !overlaps(b, { x: other.x - POINT_PX * unit, y: other.y - POINT_PX * unit, w: 2 * POINT_PX * unit, h: 2 * POINT_PX * unit }, 0))
      search: for (const within of [true, false]) {
        for (let ring = 0; ring < RINGS; ring++) {
          for (const turn of TURNS) {
            const candidate = boxAt(turn, ring)
            if (!free(candidate, within)) continue
            box = candidate
            break search
          }
        }
      }
    }
    placed.push({ ...label, box })
  }
  return placed
}

/** How far around a chip's box the pointer is still on it, in pixels: the hairline drawn round it. */
const CHIP_REACH_PX = 2

/**
 * The mark whose chip is under a point of the view (pixels from its top left, as the boxes are), among chips as they
 * were placed and drawn: the one drawn last where two meet, as it is the one seen. Null for none. Only a chip that is
 * drawn is there to be pointed at.
 */
export function chipAt(placed: readonly Placed[], x: number, y: number): string | null {
  for (let i = placed.length - 1; i >= 0; i--) {
    const { visible, box, id } = placed[i]
    if (visible && x >= box.x - CHIP_REACH_PX && x <= box.x + box.w + CHIP_REACH_PX && y >= box.y - CHIP_REACH_PX && y <= box.y + box.h + CHIP_REACH_PX) return id
  }
  return null
}

function overlaps(a: Placed['box'], b: Placed['box'], pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
}
