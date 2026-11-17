import { type BoardFile, type BuildCopy, type Card, type CardKind, AUTO_KINDS, MAX_CARDS, MAX_NAME_CHARS, PICTURE_NAME } from '../../shared/board'
import { HISTORY_ID } from '../../shared/history'
import { FRAME_HEADER, GAP, MADE_SIZE, crowds, freeSpot } from './place'

// What is on a board that the project already has: the cards that appear by themselves (reconcile) and the ones the
// person pins (pin). Both are pure: they are given a board and give the board it should be, which `BoardStore.torno`
// writes. Main chooses the place of every card; the window and the agent never do.

/** The size a card of each kind first has, in board units. */
export const CARD_SIZE: Record<'brief' | 'reference' | 'mark' | 'scan' | 'build' | 'view' | 'params' | 'checks' | 'size' | 'round', { w: number; h: number }> = {
  brief: { w: 320, h: 240 },
  reference: { w: 240, h: 180 },
  mark: { w: 240, h: 120 },
  scan: { w: 240, h: 120 },
  build: { w: 240, h: 200 },
  view: { w: 240, h: 120 },
  params: { w: 280, h: 240 },
  checks: { w: 280, h: 240 },
  /** A size the person or Claude added: the same on every board (`MADE_SIZE`). */
  size: MADE_SIZE.size,
  /** The frame of a round, first: three mark cards across and two down, the room a frame keeps for its name above them. */
  round: { w: 2 * GAP + 3 * 240 + 2 * GAP, h: FRAME_HEADER + 2 * 120 + GAP + GAP }
}

/** How many mark cards stand across a round's frame. */
const ROUND_COLUMNS = 3
/** What one more row of mark cards takes of a round's frame. */
const ROUND_ROW = CARD_SIZE.mark.h + GAP

/** The size of the frame of a round made with `items` items: `CARD_SIZE.round`, and a row more for each three past six. */
function roundFrameSize(items: number): { w: number; h: number } {
  const rows = Math.max(2, Math.ceil(items / ROUND_COLUMNS))
  return { w: CARD_SIZE.round.w, h: CARD_SIZE.round.h + (rows - 2) * ROUND_ROW }
}

/** What the project has that a card may show. */
export interface Found {
  brief: boolean
  /** The `reference/` paths of its files, as a card names them (`reference/photo-1.jpg`). */
  references: string[]
  /** `round` is the round a mark is an item of (`R1`). */
  marks: Array<{ id: string; layout: string; round?: string }>
  scans: string[]
  /** The rounds, by the name their frame has (`reviewName`) and the marks they hold, in the order of the rounds. `from` is the round a carried item came from. */
  rounds: Array<{ id: string; name: string; items: string[]; from?: string }>
}

/** A card of main's own, with no place yet (`place` gives it one). */
type Wanted = Pick<Card, 'kind' | 'source'> & { layout?: string; round?: string }

function wanted(found: Found): Wanted[] {
  return [
    ...(found.brief ? [{ kind: 'brief' as const, source: 'brief' }] : []),
    ...found.references.map((source) => ({ kind: 'reference' as const, source })),
    ...found.marks.map((m) => ({ kind: 'mark' as const, source: m.id, layout: m.layout, ...(m.round !== undefined ? { round: m.round } : {}) })),
    ...found.scans.map((source) => ({ kind: 'scan' as const, source }))
  ]
}

/** Gives `card` a free spot and the next id, and puts it on `board` (which is a copy). */
function place(board: BoardFile, card: Omit<Card, 'id' | 'x' | 'y' | 'w' | 'h'> & { kind: Exclude<keyof typeof CARD_SIZE, 'round'> }, spot?: { x: number; y: number }): void {
  const size = CARD_SIZE[card.kind]
  board.cards.push({ id: `C${board.next++}`, ...(spot ?? freeSpot(board.cards, size) ?? { x: 0, y: 0 }), ...size, ...card })
}

/** The frame main keeps for a round: a card of its own, a frame, whose source is the round. */
const frameOf = (board: BoardFile, round: string): Card | undefined => board.cards.find((c) => c.by === 'torno' && c.kind === 'frame' && c.source === round)

/**
 * A spot inside a round's frame for a card of `size` (`skip`: the card that is being moved there, which is in the way of
 * no one). When the frame is full its bottom edge goes down a row, if nothing is in the way there. Null when it has no room.
 */
function roomIn(board: BoardFile, frame: Card, size: { w: number; h: number }, skip?: string): { x: number; y: number } | null {
  const cards = board.cards.filter((c) => c.id !== skip)
  const spot = freeSpot(cards, size, frame)
  if (spot) return spot
  // The strip the frame would take: nothing may be in it but the cards the frame holds.
  const strip = { x: frame.x, y: frame.y + frame.h, w: frame.w, h: ROUND_ROW }
  if (cards.some((c) => c.id !== frame.id && c.frame !== frame.id && crowds(strip, c))) return null
  const grown = { ...frame, h: frame.h + ROUND_ROW }
  const spotInGrown = freeSpot(cards, size, grown)
  if (!spotInGrown) return null
  frame.h = grown.h
  return spotInGrown
}

/**
 * The board once the cards of what the project has are on it: a placed card of main's own (`by: 'torno'`) for each
 * source that has none (a hidden one counts: it stays hidden), and no card of main's own whose source is gone, nor
 * an arrow touching one. Pinned cards, made cards and the agent's are never touched. Null when nothing changed.
 *
 * A round with at least one item has a frame of main's own (`kind: 'frame'`, `source: 'R1'`), named for its counts, in a free
 * spot. A mark card is put in its round's frame when it is placed for the first time, or when it is in the frame of the
 * round its item was carried from; a card the person put anywhere else stays where it is. A frame the person removed
 * stays hidden, and takes no new card. A frame goes when its round has no item.
 */
export function reconcile(board: BoardFile, found: Found): BoardFile | null {
  const wants = wanted(found)
  const there = (kind: CardKind, source: string | undefined): boolean => wants.some((w) => w.kind === kind && w.source === source)
  const rounds = found.rounds.filter((r) => r.items.length > 0)
  const roundIds = new Set(rounds.map((r) => r.id))
  const gone = new Set(
    board.cards
      .filter((c) => c.by === 'torno' && ((AUTO_KINDS.includes(c.kind) && !there(c.kind, c.source)) || (c.kind === 'frame' && !roundIds.has(c.source ?? ''))))
      .map((c) => c.id)
  )
  const have = (w: Wanted): boolean => board.cards.some((c) => c.by === 'torno' && c.kind === w.kind && c.source === w.source)
  const missing = wants.filter((w) => !have(w))

  const next: BoardFile = structuredClone(board)
  let changed = gone.size > 0 || missing.length > 0
  // The items that came from an earlier round.
  const carried = found.marks.filter((m) => m.round !== undefined && rounds.some((r) => r.id === m.round && r.from !== undefined))

  // The frames of the rounds: made with their first item, named for their counts as they change.
  for (const round of rounds) {
    const frame = frameOf(next, round.id)
    if (frame) {
      if (frame.name !== round.name) {
        frame.name = round.name
        changed = true
      }
    } else if (next.cards.length - gone.size < MAX_CARDS) {
      const size = roundFrameSize(round.items.length)
      const spot = freeSpot(next.cards, size) ?? { x: 0, y: 0 }
      next.cards.push({ id: `C${next.next++}`, kind: 'frame', ...spot, ...size, by: 'torno', source: round.id, name: round.name })
      changed = true
    }
  }

  // A carried item: its card goes from the frame of the round it came from into its new round's.
  for (const m of carried) {
    const round = rounds.find((r) => r.id === m.round)
    const card = next.cards.find((c) => c.by === 'torno' && c.kind === 'mark' && c.source === m.id)
    const from = round?.from === undefined ? undefined : frameOf(next, round.from)
    const into = round === undefined ? undefined : frameOf(next, round.id)
    if (!card || card.hidden || !from || !into || into.hidden || card.frame !== from.id) continue
    const spot = roomIn(next, into, CARD_SIZE.mark, card.id)
    if (!spot) continue
    Object.assign(card, spot, { frame: into.id })
    changed = true
  }

  next.cards = next.cards.filter((c) => !gone.has(c.id))
  next.arrows = next.arrows.filter((a) => !gone.has(a.from) && !gone.has(a.to))
  for (const c of next.cards) if (c.frame !== undefined && gone.has(c.frame)) delete c.frame

  for (const w of missing) {
    if (next.cards.length >= MAX_CARDS) break
    const frame = w.round === undefined ? undefined : frameOf(next, w.round)
    const spot = frame && !frame.hidden && w.kind === 'mark' ? roomIn(next, frame, CARD_SIZE.mark) : null
    place(next, { kind: w.kind as Exclude<keyof typeof CARD_SIZE, 'round'>, by: 'torno', source: w.source, ...(w.layout !== undefined ? { layout: w.layout } : {}), ...(spot && frame ? { frame: frame.id } : {}) }, spot ?? undefined)
  }
  return changed ? next : null
}

export type Pinned =
  | { kind: 'build'; copy: BuildCopy; layout?: string; picture?: string }
  | { kind: 'view'; name: string; layout?: string }
  | { kind: 'params' }
  | { kind: 'checks' }

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

/**
 * The board with a card the person pinned on it, in a free spot, or why it was not (`refused`). A pinned card is
 * the person's (`by: 'person'`): it goes only when they remove it. The Params and the checks are on a board once each.
 */
export function pin(board: BoardFile, what: Pinned): BoardFile | { refused: string } {
  if (board.cards.length >= MAX_CARDS) return { refused: `The board holds ${MAX_CARDS} cards, and that is all it takes.` }
  const next: BoardFile = structuredClone(board)
  switch (what.kind) {
    case 'build': {
      const { copy } = what
      if (!copy || !HISTORY_ID.test(copy.id) || !text(copy.line, 1000) || !text(copy.cause, 40) || !text(copy.sources, 200)) return { refused: 'That build cannot be pinned: it is not one the history keeps.' }
      if (what.picture !== undefined && !PICTURE_NAME.test(what.picture)) return { refused: 'The picture of a build is one torno kept on the board.' }
      place(next, {
        kind: 'build',
        by: 'person',
        source: copy.id,
        copy: { id: copy.id, line: copy.line, cause: copy.cause, sources: copy.sources },
        ...(what.layout !== undefined ? { layout: what.layout } : {}),
        ...(what.picture !== undefined ? { picture: what.picture } : {})
      })
      return next
    }
    case 'view': {
      if (typeof what.name !== 'string' || what.name === '' || what.name.length > MAX_NAME_CHARS) return { refused: 'A view is pinned by its name.' }
      place(next, { kind: 'view', by: 'person', source: what.name, ...(what.layout !== undefined ? { layout: what.layout } : {}) })
      return next
    }
    case 'params':
    case 'checks': {
      if (board.cards.some((c) => c.kind === what.kind)) return { refused: what.kind === 'params' ? 'The Params are on this board already.' : 'The checks are on this board already.' }
      place(next, { kind: what.kind, by: 'person', source: what.kind })
      return next
    }
    default:
      return { refused: 'That is not something the board takes.' }
  }
}
