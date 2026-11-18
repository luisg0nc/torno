/**
 * Where a tag goes (spec 2026-11-18, section 2, "Tags"): beside what it is about, on the first of four sides where it
 * fits, clear of the reed, the compass, the band and other tags; docked above the hint, with no leader, where it has
 * no subject to stand by. Pure, in pixels of one frame of reference (the view's pane, or the window's).
 */
import { SHOULDER, type Box, type Pt } from './leader'

export type Side = 'above' | 'right' | 'below' | 'left' | 'docked'

/** What stands clear on the left of the view for the reed (the tools), in px. */
export const REED_CLEAR = 60
/** How far from its subject a tag stands: room for the leader's ring and its shoulder. */
export const GAP = 24
/** What the hint at the foot of the view takes, in px: a docked tag stands above it. */
export const HINT_CLEAR = 56

export interface PlaceOptions {
  /**
   * The box the tag must clear, where the subject is a thing with a size (the note of a mark): the gap is from its
   * edge, not from the subject's point. Defaults to the point.
   */
  around?: Box
  /** The gap in place of `GAP`. */
  gap?: number
  /** On the left and right sides, the tag's top this far above the subject, in place of centring it. */
  rise?: number
  /** Clear on the left, in place of `REED_CLEAR` (0 where the view is already the part the reed leaves). */
  clearLeft?: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)))
const meets = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by })
const holds = (b: Box, p: Pt): boolean => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

const ORDER: Side[] = ['above', 'right', 'below', 'left']

/**
 * The tag of `size` for `subject` inside `view`, avoiding the boxes in `avoid`. It tries `prefer` (the side it had the
 * last time: so a tag does not hop between sides as the camera moves), then above, right, below and left, each clamped
 * inside the view with `REED_CLEAR` px on the left. A side is skipped where the clamp leaves the tag over its subject,
 * or short of the room a leader needs, or meeting an `avoid` box. With no subject, or no side that fits, the tag is
 * `docked`, at the bottom middle of the view above the hint.
 */
export function placeTag(subject: Pt | null, size: { w: number; h: number }, view: Box, avoid: Box[], prefer?: Side, options: PlaceOptions = {}): { box: Box; side: Side } {
  const docked = (): { box: Box; side: Side } => ({
    box: { x: view.x + (view.w - size.w) / 2, y: view.y + view.h - HINT_CLEAR - size.h, w: size.w, h: size.h },
    side: 'docked'
  })
  if (!subject) return docked()
  const around = options.around ?? { x: subject.x, y: subject.y, w: 0, h: 0 }
  const gap = options.gap ?? GAP
  const minX = view.x + (options.clearLeft ?? REED_CLEAR)
  const maxX = view.x + view.w - size.w
  const minY = view.y
  const maxY = view.y + view.h - size.h
  const { w, h } = size
  const at = (side: Exclude<Side, 'docked'>): Box => {
    const across = (centre: number, length: number): number => centre - length / 2
    switch (side) {
      case 'above':
        return { x: clamp(across(subject.x, w), minX, maxX), y: clamp(around.y - gap - h, minY, maxY), w, h }
      case 'below':
        return { x: clamp(across(subject.x, w), minX, maxX), y: clamp(around.y + around.h + gap, minY, maxY), w, h }
      case 'right':
        return { x: clamp(around.x + around.w + gap, minX, maxX), y: clamp(options.rise === undefined ? across(subject.y, h) : subject.y - options.rise, minY, maxY), w, h }
      case 'left':
        return { x: clamp(around.x - gap - w, minX, maxX), y: clamp(options.rise === undefined ? across(subject.y, h) : subject.y - options.rise, minY, maxY), w, h }
    }
  }
  const tried = [...(prefer && prefer !== 'docked' ? [prefer] : []), ...ORDER.filter((s) => s !== prefer)] as Array<Exclude<Side, 'docked'>>
  for (const side of tried) {
    const box = at(side)
    // The clamp may have pushed the tag onto the thing it is about, or (a point having no size) short of the leader's room.
    if (meets(box, around) || (!options.around && holds(grow(box, SHOULDER), subject)) || avoid.some((a) => meets(box, a))) continue
    return { box, side }
  }
  return docked()
}

/**
 * The subject a tag stands by, or none: a subject that is not in the view (off its edge, behind the camera: null) has no
 * place to tie a leader to, so its tag docks. A subject seen edge on is the tool's to call none: it knows its plane.
 */
export function tagSubject(point: Pt | null, view: Box): Pt | null {
  return point && holds(view, point) ? point : null
}
