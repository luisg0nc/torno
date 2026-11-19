import type { ObjectCard } from '../../shared/show'
import { BENCH_MM_PER_PX, THUMB_HEIGHT, THUMB_WIDTH } from '../../shared/thumbnail'
import { screenHalfExtent, viewDirection } from '../viewport/views'

// The bench: the page of projects at true scale. Who stands on which shelf, how big each picture stands, the one
// scale for the whole page and how the shelves wrap. Pure: ShowPage.tsx draws what this says.

export interface Shelves {
  /** Those whose session waits on you. */
  needs: ObjectCard[]
  /** Those that build, or whose session works. */
  working: ObjectCard[]
  /** All the others, the one saved last first. */
  rest: ObjectCard[]
}

/** How the page draws its pictures: each at true scale on the bench, or fitted to equal boxes. */
export type BenchMode = 'scale' | 'grid'

/** A project waits on you when its session asks (`waiting`) or needs input. */
const needsYou = (card: ObjectCard): boolean => card.waiting !== undefined || card.session === 'needs_input'
/** It works when it builds, or Claude Code works in it. */
const working = (card: ObjectCard): boolean => (card.opened && card.build?.status === 'building') || card.session === 'working'

/** How the rest is ordered: the last save of the model first (the default), or by name, as the list has them. */
export type Order = 'name' | 'recent'

/**
 * Who needs you first, then who works, then the rest, which `order` puts by the last save of the model, newest first
 * (a project with no saved model last; equal saves keep the list's order, the open one (`openId`) before the rest of them),
 * or by name, in the list's order. Needs you and Working stand ahead of either, in the list's order.
 */
export function shelvesOf(cards: ObjectCard[], openId: string | null, order: Order = 'recent'): Shelves {
  const needs: ObjectCard[] = []
  const busy: ObjectCard[] = []
  const rest: { card: ObjectCard; i: number }[] = []
  cards.forEach((card, i) => {
    if (needsYou(card)) needs.push(card)
    else if (working(card)) busy.push(card)
    else rest.push({ card, i })
  })
  if (order === 'recent') rest.sort((a, b) => (b.card.sourcesMtimeMs ?? -Infinity) - (a.card.sourcesMtimeMs ?? -Infinity) || Number(b.card.id === openId) - Number(a.card.id === openId) || a.i - b.i)
  return { needs, working: busy, rest: rest.map((x) => x.card) }
}

/** The room round a picture's part, in its own pixels, for the edge lines of what is at the limit (`views.ts` `benchFits`). */
const MARGIN_PX = 2
/** What a project that has no size yet stands as, and an equal box of Grid, in px. */
export const GHOST = { w: 120, h: 80 }
export const TILE = { w: 160, h: 120 }
/** The space between those on a shelf, and at its two ends, in px. */
export const GAP = 40
export const PAD = 20
/** No label is set narrower than this: what is said under a small part needs its room. */
export const CELL_MIN = 140
/** Below this a picture is not worth reading: the shelf wraps instead. */
export const MIN_SCALE = 0.25
/** The two shelves on top stand this far apart. */
export const SHELVES_GAP = 36

export type Look = { kind: 'scale'; w: number; h: number } | { kind: 'tile' } | { kind: 'ghost' }

/**
 * How a project stands: at true scale when its picture was made for the bench (and then `w` × `h` is the box
 * projected, in the picture's own pixels), in Grid's look when it has a picture that is not (or no size), and as a
 * dashed box when it has no picture. The page never claims a size the kernel did not give.
 */
export function lookOf(card: ObjectCard): Look {
  if (card.thumb === null || card.problem !== undefined) return { kind: 'ghost' }
  if (!card.thumb.bench || !card.box) return { kind: 'tile' }
  const { dir, up } = viewDirection('iso')
  const { across, upward } = screenHalfExtent(card.box, dir, up)
  // Even, so that the part is centred on a pixel.
  const px = (half: number, limit: number): number => Math.min(limit, 2 * Math.ceil(half / BENCH_MM_PER_PX + MARGIN_PX))
  return { kind: 'scale', w: px(across, THUMB_WIDTH), h: px(upward, THUMB_HEIGHT) }
}

/** What is drawn for a project, in the page's pixels: the box it takes, and for a picture at scale how it is cropped. */
export interface Figure {
  kind: Look['kind']
  w: number
  h: number
  /** The picture whole (480 × 360 at the page's scale) and where it lies in the box, so that the box shows only the part. */
  img?: { w: number; h: number; x: number; y: number }
}

/** `scale` is the page's one scale (`pageScale`); in Grid every picture is fitted to an equal box instead. */
export function figureOf(card: ObjectCard, mode: BenchMode, scale: number): Figure {
  const look = lookOf(card)
  if (look.kind === 'ghost') return mode === 'grid' ? { kind: 'ghost', ...TILE } : { kind: 'ghost', ...GHOST }
  if (look.kind === 'tile') return { kind: 'tile', ...TILE }
  // Fitted to the equal box, with a little room round it, and no more than twice what the picture has.
  const s = mode === 'grid' ? Math.min(2, (TILE.w - 16) / look.w, (TILE.h - 16) / look.h) : scale
  return {
    kind: 'scale',
    w: Math.round(look.w * s),
    h: Math.round(look.h * s),
    img: { w: THUMB_WIDTH * s, h: THUMB_HEIGHT * s, x: (-(THUMB_WIDTH - look.w) / 2) * s, y: (-(THUMB_HEIGHT - look.h) / 2) * s }
  }
}

/** The width of what stands on the shelf for a figure: its label is at least `CELL_MIN` wide. */
export const cellWidth = (figure: Figure): number => Math.max(figure.w, CELL_MIN)

/** The width one shelf holding all of these takes at this scale: the ends, the gaps and the cells. */
export function widthOf(cards: ObjectCard[], scale: number, mode: BenchMode = 'scale'): number {
  const cells = cards.reduce((sum, card) => sum + cellWidth(figureOf(card, mode, scale)) + GAP, 0)
  return 2 * PAD + cells
}

/**
 * The scale of the page, to one shelf holding all of `cards` in the width given: the largest that fits, at most 1
 * (the picture's own pixels) and at least `MIN_SCALE`, below which the shelf wraps (`packRows`).
 */
export function benchScale(cards: ObjectCard[], shelfWidth: number): number {
  if (cards.length === 0 || widthOf(cards, 1) <= shelfWidth) return 1
  let [low, high] = [MIN_SCALE, 1]
  if (widthOf(cards, low) > shelfWidth) return MIN_SCALE
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2
    if (widthOf(cards, mid) <= shelfWidth) low = mid
    else high = mid
  }
  return low
}

/** The one scale of the page: the narrowest fit of its three shelves, the two on top side by side. 1 in Grid, where nothing is at scale. */
export function pageScale(shelves: Shelves, width: number, mode: BenchMode): number {
  if (mode === 'grid') return 1
  const top = shelves.needs.length > 0 && shelves.working.length > 0 ? (width - SHELVES_GAP) / 2 : width
  return Math.min(benchScale(shelves.needs, top), benchScale(shelves.working, top), benchScale(shelves.rest, width))
}

/** The shelf cut into the rows that each fit the width: one, when they all do. A row holds at least one. */
export function packRows(cards: ObjectCard[], width: number, scale: number, mode: BenchMode): ObjectCard[][] {
  const rows: ObjectCard[][] = []
  for (const card of cards) {
    const last = rows[rows.length - 1]
    if (last && widthOf([...last, card], scale, mode) <= width) last.push(card)
    else rows.push([card])
  }
  return rows
}

/** Where the arrow keys go between the lines of shelves: `spots` are the cards in the page's order, with the line each stands on and where its middle is. */
export function stepAcross(way: 'up' | 'down', at: number, spots: { line: number; x: number }[]): number | 'field' {
  if (spots.length === 0) return 'field'
  if (at < 0 || at >= spots.length) return 0
  const line = spots[at].line + (way === 'up' ? -1 : 1)
  let best = -1
  spots.forEach((spot, i) => {
    if (spot.line === line && (best < 0 || Math.abs(spot.x - spots[at].x) < Math.abs(spots[best].x - spots[at].x))) best = i
  })
  if (best >= 0) return best
  return way === 'up' ? 'field' : at
}
