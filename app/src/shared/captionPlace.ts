/**
 * Where the caption stands by the pointer (`ui/ToolHint.tsx`): 18 px below it and to its right, in the pixels of the
 * view's pane; to the left of the pointer or above it where it would run out of the pane, and never outside it.
 * `between` is the height of what already stands on the same side of the pointer (the readout of what is under it):
 * the caption stands beyond it, a hair apart, so that the two are both read.
 */

export const CAPTION_OFFSET = 18
const MARGIN = 8
const APART = 4

export function captionPlace(pointer: readonly [number, number], size: { width: number; height: number }, pane: { width: number; height: number }, between = 0): [number, number] {
  const gap = between > 0 ? between + APART : 0
  let x = pointer[0] + CAPTION_OFFSET
  let y = pointer[1] + CAPTION_OFFSET + gap
  if (x + size.width > pane.width - MARGIN) x = Math.max(MARGIN, pointer[0] - CAPTION_OFFSET - size.width)
  if (y + size.height > pane.height - MARGIN) y = Math.max(MARGIN, pointer[1] - CAPTION_OFFSET - gap - size.height)
  return [x, y]
}
