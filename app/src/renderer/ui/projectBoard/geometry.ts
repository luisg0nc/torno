import type { Card } from '../../../shared/board'
import type { Box } from './Camera'

// The plain geometry of the board, apart from the page: the box of the cards, where an arrow runs, and how the minimap
// maps the board into its frame.

/** The sheet shown for a board with nothing on it. */
const EMPTY_BOX: Box = { x: 0, y: 0, w: 800, h: 600 }

/** The box that holds every card that is shown. */
export function boardBox(cards: readonly Card[]): Box {
  const shown = cards.filter((c) => !c.hidden)
  if (shown.length === 0) return { ...EMPTY_BOX }
  const x = Math.min(...shown.map((c) => c.x))
  const y = Math.min(...shown.map((c) => c.y))
  return { x, y, w: Math.max(...shown.map((c) => c.x + c.w)) - x, h: Math.max(...shown.map((c) => c.y + c.h)) - y }
}

/** Where the line from the middle of a box towards a point leaves the box. */
function leaves(box: Card, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scale = Math.min(dx === 0 ? Infinity : box.w / 2 / Math.abs(dx), dy === 0 ? Infinity : box.h / 2 / Math.abs(dy))
  return { x: cx + dx * scale, y: cy + dy * scale }
}

/** The line of an arrow from one card to another: from the edge of the first to the edge of the second, along the line between their middles. */
export function arrowLine(from: Card, to: Card): { x1: number; y1: number; x2: number; y2: number } {
  const a = leaves(from, to.x + to.w / 2, to.y + to.h / 2)
  const b = leaves(to, from.x + from.w / 2, from.y + from.h / 2)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

/** The room the minimap keeps round what it draws, in its own pixels. */
const MINIMAP_MARGIN = 6

/** How the minimap maps a box of the board into its frame: the whole box inside it, centred. */
export function minimapMap(box: Box, frame: { width: number; height: number }): { k: number; toMap(bx: number, by: number): { x: number; y: number }; toBoard(mx: number, my: number): { x: number; y: number } } {
  const k = Math.min((frame.width - 2 * MINIMAP_MARGIN) / Math.max(box.w, 1), (frame.height - 2 * MINIMAP_MARGIN) / Math.max(box.h, 1))
  const ox = frame.width / 2 - (box.x + box.w / 2) * k
  const oy = frame.height / 2 - (box.y + box.h / 2) * k
  return {
    k,
    toMap: (bx, by) => ({ x: bx * k + ox, y: by * k + oy }),
    toBoard: (mx, my) => ({ x: (mx - ox) / k, y: (my - oy) / k })
  }
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The frame a card at `rect` is in: the smallest shown frame its middle is inside, leaving out those named in `except`. */
export function frameAt(cards: readonly Card[], rect: Rect, except: readonly string[] = []): string | null {
  const mx = rect.x + rect.w / 2
  const my = rect.y + rect.h / 2
  const inside = cards.filter((c) => c.kind === 'frame' && !c.hidden && !except.includes(c.id) && mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h)
  inside.sort((a, b) => a.w * a.h - b.w * b.h)
  return inside[0]?.id ?? null
}

/** The cards a frame drawn at `rect` takes in: those shown, in no frame, that are not frames, with their middles inside. */
export function cardsIn(cards: readonly Card[], rect: Rect): string[] {
  return cards
    .filter((c) => c.kind !== 'frame' && !c.hidden && c.frame === undefined && c.x + c.w / 2 >= rect.x && c.x + c.w / 2 <= rect.x + rect.w && c.y + c.h / 2 >= rect.y && c.y + c.h / 2 <= rect.y + rect.h)
    .map((c) => c.id)
}

/** The room a picture card is first given, in board units. */
const PICTURE_ROOM = { w: 320, h: 240 }

/** A picture card's size: the picture's proportion inside 320 by 240, and no larger than the picture itself. */
export function pictureSize(width: number, height: number): { w: number; h: number } {
  if (!(width > 0) || !(height > 0)) return { ...PICTURE_ROOM }
  const k = Math.min(1, PICTURE_ROOM.w / width, PICTURE_ROOM.h / height)
  return { w: Math.round(width * k), h: Math.round(height * k) }
}

/** The cards (and frames) whose boxes touch `rect`; a frame only when `rect` holds the whole of it. */
export function cardsTouching(cards: readonly Card[], rect: Rect): string[] {
  return cards
    .filter((c) => {
      if (c.hidden) return false
      if (c.kind === 'frame') return c.x >= rect.x && c.y >= rect.y && c.x + c.w <= rect.x + rect.w && c.y + c.h <= rect.y + rect.h
      return c.x < rect.x + rect.w && c.x + c.w > rect.x && c.y < rect.y + rect.h && c.y + c.h > rect.y
    })
    .map((c) => c.id)
}
