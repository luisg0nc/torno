/**
 * Where the caption stands by the pointer (`ui/ToolHint.tsx`): 18 px below it and to its right, in the pixels of the
 * view's pane; to the left of the pointer or above it where it would run out of the pane, and never outside it.
 * `between` is the height of what already stands on the same side of the pointer (the readout of what is under it):
 * the caption stands beyond it, a hair apart, so that the two are both read. `avoid` are boxes of the view's pane it keeps
 * clear of (the switch of Model and Board, a band, at the top left): where the placement would cover one, the caption
 * stands below the lowest it meets, or above the highest where the pane has no room below.
 */

export const CAPTION_OFFSET = 18
const MARGIN = 8
const APART = 4

export interface CaptionBox {
  x: number
  y: number
  width: number
  height: number
}

export function captionPlace(
  pointer: readonly [number, number],
  size: { width: number; height: number },
  pane: { width: number; height: number },
  between = 0,
  avoid: readonly CaptionBox[] = []
): [number, number] {
  const gap = between > 0 ? between + APART : 0
  let x = pointer[0] + CAPTION_OFFSET
  let y = pointer[1] + CAPTION_OFFSET + gap
  if (x + size.width > pane.width - MARGIN) x = Math.max(MARGIN, pointer[0] - CAPTION_OFFSET - size.width)
  if (y + size.height > pane.height - MARGIN) y = Math.max(MARGIN, pointer[1] - CAPTION_OFFSET - gap - size.height)
  const met = (at: number): CaptionBox[] => avoid.filter((b) => b.width > 0 && b.height > 0 && x < b.x + b.width && b.x < x + size.width && at < b.y + b.height && b.y < at + size.height)
  const covered = met(y)
  if (covered.length > 0) {
    const below = Math.max(...covered.map((b) => b.y + b.height)) + APART
    const above = Math.min(...covered.map((b) => b.y)) - APART - size.height
    if (below + size.height <= pane.height - MARGIN) y = below
    else y = Math.max(MARGIN, above)
  }
  return [x, y]
}
