import * as THREE from 'three'
import { NO_VALUE, shownDimension } from '../../../shared/dimension'
import type { DimensionMark, Mark, RegionMark, Vec3 } from '../../../shared/marks'
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
  /** The value is of another build than the one drawn: it is written faint, and has no verdict. */
  stale?: true
}

/**
 * A dimension's value as its chip writes it on the build `revision`, by the
 * rule of its row (`shownDimension`): the value measured on that build, with
 * its verdict; the last one it had, with the build it is of after it
 * (`6 mm (r11)`) and marked stale, when it has not been measured on that
 * build; `—` when it has none, or only one its file holds from a run before. The same on screen and in a picture for the
 * agent, where a value that was only fainter would be read as the part's.
 */
export function labelValue(mark: DimensionMark, revision: number | undefined): LabelValue {
  const shown = shownDimension(mark, revision)
  if (shown.value !== undefined) return { text: shown.text, ...(shown.verdict ? { verdict: shown.verdict } : {}) }
  if (!shown.stale) return { text: NO_VALUE }
  return { text: `${shown.text} (${shown.of === undefined ? 'earlier' : `r${shown.of}`})`, stale: true }
}

/** How large the chip of a label is: of its text and, for a dimension, its value beside it. */
export type Chip = (text: string, value?: LabelValue) => { w: number; h: number }

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

/** What a mark is called on screen and in pictures. */
export function labelText(mark: Pick<Mark, 'id' | 'anchorState'>): string {
  return mark.id + (mark.anchorState === 'drifted' ? '~' : mark.anchorState === 'orphaned' ? '?' : '')
}

/** What a mark is called in its row: the row says in words what the last build did to it, so its chip is the id alone. */
export function rowLabel(mark: Pick<Mark, 'id' | 'anchorState'>): string {
  return mark.id
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
  return marks.map((mark) => {
    const anchor = labelAnchor(mark, regionAt)
    const point = new THREE.Vector3().fromArray(anchor.point)
    if (movedBy) point.add(new THREE.Vector3().fromArray(movedBy(mark)))
    const base: Pick<Label, 'id' | 'text' | 'author' | 'value'> = { id: mark.id, text: labelText(mark), author: mark.author }
    if (mark.kind === 'dimension') base.value = labelValue(mark, revision)
    const foot = toPx(point)
    if (!anchor.leader) return { ...base, ...foot, lean: DEFAULT_LEAN, gap: GAP_PX * unit }

    // A pin's label hangs at the end of its leader, and leans the way the leader runs on screen: so does that of whatever else has one.
    const reach = (anchor.reach ?? LEADER_PX) * unit * mmPerPx(camera, point, size.height)
    const end = toPx(point.clone().addScaledVector(new THREE.Vector3().fromArray(anchor.leader), reach))
    const run = Math.hypot(end.x - foot.x, end.y - foot.y)
    // Seen end on, the leader is a point: the chip goes above the pin, clear of its dot.
    const lean: [number, number] = run > 2 * unit ? [(end.x - foot.x) / run, (end.y - foot.y) / run] : [0, -1]
    return { ...base, x: end.x, y: end.y, visible: foot.visible, lean, gap: Math.max(2 * unit, CLEAR_PX * unit - run) }
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
    const { w, h } = chip(label.text, label.value)
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

function overlaps(a: Placed['box'], b: Placed['box'], pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
}
