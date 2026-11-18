import { placeTag, type Side } from '../../shared/tagPlace'

/** A box in pixels, from the top left of the viewport pane. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Room left between the note and its mark. */
export const NOTE_GAP = 12
/** How far above its mark's point the top of a note beside it starts. */
const RISE = 18
/** What is treated as the mark when the whole of it leaves no room: this much around its point. */
const POINT_REACH = 14

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, Math.max(low, high)))
}

/**
 * Where the note of a mark goes so that it does not cover the mark: beside it, on the side with more room (the rule of a
 * tag, `placeTag`, tried from that side), failing that below or above it. `mark` is what the mark covers and `at` its
 * point, `card` the size of the note, and `within` the part of the pane it may use. A mark that leaves no room on any
 * side (an arrow across the whole view) is taken for its point alone. The answer is the note's top left corner.
 */
export function placeBeside(mark: Box, at: [number, number], card: { w: number; h: number }, within: Box): { x: number; y: number; side: 'right' | 'left' | 'below' | 'above' } {
  const view = { x: within.left, y: within.top, w: within.right - within.left, h: within.bottom - within.top }
  const subject = { x: at[0], y: at[1] }
  const around = (box: Box) => ({ x: box.left, y: box.top, w: box.right - box.left, h: box.bottom - box.top })
  const beside = (box: Box): { x: number; y: number; side: 'right' | 'left' | 'below' | 'above' } | null => {
    const horizontal: Side = within.right - box.right >= box.left - within.left ? 'right' : 'left'
    const placed = placeTag(subject, card, view, [], horizontal, { around: around(box), gap: NOTE_GAP, rise: RISE, clearLeft: 0 })
    return placed.side === 'docked' ? null : { x: placed.box.x, y: placed.box.y, side: placed.side }
  }
  const point: Box = { left: at[0] - POINT_REACH, top: at[1] - POINT_REACH, right: at[0] + POINT_REACH, bottom: at[1] + POINT_REACH }
  const found = beside(mark) ?? beside(point)
  if (found) return found
  // No side has room even for the point: beside it all the same, on the side with more room, kept inside the pane.
  const right = within.right - point.right >= point.left - within.left
  const x = right ? point.right + NOTE_GAP : point.left - NOTE_GAP - card.w
  return { x: clamp(x, within.left, within.right - card.w), y: clamp(at[1] - RISE, within.top, within.bottom - card.h), side: right ? 'right' : 'left' }
}
