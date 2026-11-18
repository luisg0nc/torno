/** A box in pixels of the window: the anchor, or the view. */
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** How far the card stands from its anchor (room for the stem), and from the window's edge, in px. */
const GAP = 10
const MARGIN = 8
/** The stem keeps this far from the card's corners. */
const STEM_EDGE = 14

export interface PopoverAt {
  x: number
  y: number
  side: 'below' | 'above'
  /** Where the stem is along the card's top or bottom edge, in px from its left. */
  stem: number
}

/**
 * Where a popover of `size` stands for an `anchor`: on the side asked for, centred on the anchor and kept inside
 * the window `view`; on the other side when this one has no room and that one has more. The stem is where the anchor
 * is, along the edge it comes out of.
 */
export function placePopover(anchor: Rect, size: { w: number; h: number }, view: { w: number; h: number }, side: 'below' | 'above'): PopoverAt {
  const roomBelow = view.h - (anchor.y + anchor.h) - GAP - MARGIN
  const roomAbove = anchor.y - GAP - MARGIN
  const chosen = side === 'below' ? (roomBelow >= size.h || roomBelow >= roomAbove ? 'below' : 'above') : roomAbove >= size.h || roomAbove >= roomBelow ? 'above' : 'below'
  const y = chosen === 'below' ? anchor.y + anchor.h + GAP : anchor.y - GAP - size.h
  const centre = anchor.x + anchor.w / 2
  const x = Math.max(MARGIN, Math.min(centre - size.w / 2, view.w - MARGIN - size.w))
  const stem = Math.max(STEM_EDGE, Math.min(centre - x, size.w - STEM_EDGE))
  return { x, y, side: chosen, stem }
}
