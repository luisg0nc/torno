import type { Card } from '../../shared/board'

// Where a card that has no place yet goes: a free spot on the board, or inside a frame. Pure; main stores what it says.

/** The space kept clear around a card, in board units. */
export const GAP = 24
/** A row of cards is wrapped before it passes this. */
export const ROW_WIDTH = 2400
/** The room a frame keeps at its top for its name. */
export const FRAME_HEADER = 32

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Whether two boxes are closer than `GAP`, or overlap. */
const crowds = (a: Box, b: Box): boolean => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP

const clear = (spot: Box, among: readonly Box[]): boolean => !among.some((c) => crowds(spot, c))

/** A spot for a box of `size` among `cards`, tried row by row, by the edges of what is there. Null when `fits` takes none. */
function scan(size: { w: number; h: number }, among: readonly Box[], from: { x: number; y: number }, fits: (spot: Box) => boolean): { x: number; y: number } | null {
  const xs = [...new Set([from.x, ...among.map((c) => c.x + c.w + GAP)])].sort((a, b) => a - b)
  const ys = [...new Set([from.y, ...among.map((c) => c.y + c.h + GAP)])].sort((a, b) => a - b)
  for (const y of ys) {
    for (const x of xs) {
      const spot = { x, y, ...size }
      if (x >= from.x && y >= from.y && fits(spot) && clear(spot, among)) return { x, y }
    }
  }
  return null
}

/**
 * A place for a card of `size`, never within `GAP` of another card's box (a frame is a card). Without `within`: to
 * the right of the last row of cards, wrapping below them at `ROW_WIDTH`, and always a spot. With `within`, a
 * frame: a spot inside it, below its name, or null when it has none.
 */
export function freeSpot(cards: readonly Card[], size: { w: number; h: number }, within?: Card): { x: number; y: number } | null {
  if (within) {
    const inner = { x: within.x + GAP, y: within.y + FRAME_HEADER, w: within.w - 2 * GAP, h: within.h - FRAME_HEADER - GAP }
    if (size.w > inner.w || size.h > inner.h) return null
    const among = cards.filter((c) => c.id !== within.id && c.x < within.x + within.w && c.y < within.y + within.h && c.x + c.w > within.x && c.y + c.h > within.y)
    return scan(size, among, inner, (s) => s.x + s.w <= inner.x + inner.w && s.y + s.h <= inner.y + inner.h)
  }
  if (cards.length === 0) return { x: 0, y: 0 }
  // The common case, in one pass: after the last row, or below everything when the row is full.
  const top = Math.max(...cards.map((c) => c.y))
  const row = cards.filter((c) => c.y >= top - size.h / 2)
  const right = Math.max(...row.map((c) => c.x + c.w)) + GAP
  const spot = right + size.w <= ROW_WIDTH ? { x: right, y: top } : { x: 0, y: Math.max(...cards.map((c) => c.y + c.h)) + GAP }
  if (clear({ ...spot, ...size }, cards)) return spot
  // Something is in the way (a frame, a card moved there): the first free place from the top left, then below all of it.
  return scan(size, cards, { x: 0, y: 0 }, (s) => s.x + s.w <= ROW_WIDTH) ?? { x: 0, y: Math.max(...cards.map((c) => c.y + c.h)) + GAP }
}

/** A place for a box of `size` just below `frame`, at its left edge, a gap away; further right or down when something is there. Never null. */
export function freeSpotBelow(cards: readonly Card[], size: { w: number; h: number }, frame: Card): { x: number; y: number } {
  const from = { x: frame.x, y: frame.y + frame.h + GAP }
  return scan(size, cards, from, () => true) ?? { x: from.x, y: Math.max(...cards.map((c) => c.y + c.h)) + GAP }
}

/** The sizes of the cards the agent makes. */
export const MADE_SIZE = { text: { w: 280, h: 160 }, picture: { w: 320, h: 240 }, frame: { w: 720, h: 480 }, size: { w: 240, h: 120 } } as const
