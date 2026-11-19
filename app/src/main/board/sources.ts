import { type BoardFile, type BuildCopy, type Card, type CardKind, AUTO_KINDS, COPY_KINDS, MAX_CARDS, MAX_NAME_CHARS, PICTURE_NAME, ROUND_SOURCE } from '../../shared/board'
import { HISTORY_ID } from '../../shared/history'
import { MADE_SIZE, freeSpot } from './place'

// What is on a board that the project already has: the cards that appear by themselves (reconcile) and the ones the
// person pins (pin). Both are pure: they are given a board and give the board it should be, which `BoardStore.torno`
// writes. Main chooses the place of every card; the window and the agent never do.

/** The size a card of each kind first has, in board units. */
export const CARD_SIZE: Record<'brief' | 'reference' | 'build' | 'view' | 'params' | 'checks' | 'size', { w: number; h: number }> = {
  brief: { w: 320, h: 240 },
  reference: { w: 240, h: 180 },
  build: { w: 240, h: 200 },
  view: { w: 240, h: 120 },
  params: { w: 280, h: 240 },
  checks: { w: 280, h: 240 },
  /** A size the person or Claude added: the same on every board (`MADE_SIZE`). */
  size: MADE_SIZE.size
}

/** What the project has that a card may show. */
export interface Found {
  brief: boolean
  /** The `reference/` paths of its files, as a card names them (`reference/photo-1.jpg`). */
  references: string[]
  /** The ids of the marks, scans and tracings (`M1`, `S1`, `T1`): no card is made for them, but an old one goes when its thing does. */
  marks: string[]
  scans: string[]
  tracings: string[]
}

/** A card of main's own, with no place yet (`place` gives it one). */
type Wanted = Pick<Card, 'kind' | 'source'>

/** The cards main makes by itself: the brief and the files of `reference/`. Nothing else (#248). */
function wanted(found: Found): Wanted[] {
  return [...(found.brief ? [{ kind: 'brief' as const, source: 'brief' }] : []), ...found.references.map((source) => ({ kind: 'reference' as const, source }))]
}

/** Gives `card` a free spot and the next id, and puts it on `board` (which is a copy). */
function place(board: BoardFile, card: Omit<Card, 'id' | 'x' | 'y' | 'w' | 'h'> & { kind: keyof typeof CARD_SIZE }, spot?: { x: number; y: number }, made?: { w: number; h: number }): void {
  const size = made ?? CARD_SIZE[card.kind]
  board.cards.push({ id: `C${board.next++}`, ...(spot ?? freeSpot(board.cards, size) ?? { x: 0, y: 0 }), ...size, ...card })
}

/**
 * The board once the cards of what the project has are on it: a placed card of main's own (`by: 'torno'`) for the brief
 * and each file of `reference/` that has none (a hidden one counts: it stays hidden), and no card of main's own whose
 * source is gone, nor an arrow touching one. Pinned cards, made cards and the agent's are never touched. Null when
 * nothing changed.
 *
 * Marks, scans, tracings and review rounds get no card (#248). A board made before that still holds some, and the first
 * time it is read they are looked at once, never again: a copy that is not in a frame of the person's (it was never
 * placed) is hidden, a round's frame is hidden, and one the person put in a frame of their own stays. Nothing is
 * removed: "Hidden cards" brings back what was hidden. `tidied` says it was done.
 */
export function reconcile(board: BoardFile, found: Found): BoardFile | null {
  const wants = wanted(found)
  const alive = { mark: new Set(found.marks), scan: new Set(found.scans), tracing: new Set(found.tracings) }
  const there = (kind: CardKind, source: string | undefined): boolean => {
    if (kind === 'mark' || kind === 'scan' || kind === 'tracing') return source !== undefined && alive[kind].has(source)
    return wants.some((w) => w.kind === kind && w.source === source)
  }
  const gone = new Set(board.cards.filter((c) => c.by === 'torno' && AUTO_KINDS.includes(c.kind) && !there(c.kind, c.source)).map((c) => c.id))
  const have = (w: Wanted): boolean => board.cards.some((c) => c.by === 'torno' && c.kind === w.kind && c.source === w.source)
  const missing = wants.filter((w) => !have(w))

  const next: BoardFile = structuredClone(board)
  let changed = gone.size > 0 || missing.length > 0

  if (next.tidied !== true) {
    const ofTorno = new Set(next.cards.filter((c) => c.by === 'torno' && c.kind === 'frame').map((c) => c.id))
    const old = next.cards.filter((c) => c.by === 'torno' && (COPY_KINDS.includes(c.kind) || (c.kind === 'frame' && ROUND_SOURCE.test(c.source ?? ''))))
    // A board with no old copy has nothing to look at, and is left as it is (no file is written for it).
    if (old.length > 0) {
      for (const c of old) {
        if (c.kind === 'frame' || c.frame === undefined || ofTorno.has(c.frame)) c.hidden = true
      }
      next.tidied = true
      changed = true
    }
  }

  next.cards = next.cards.filter((c) => !gone.has(c.id))
  next.arrows = next.arrows.filter((a) => !gone.has(a.from) && !gone.has(a.to))
  for (const c of next.cards) if (c.frame !== undefined && gone.has(c.frame)) delete c.frame

  for (const w of missing) {
    if (next.cards.length >= MAX_CARDS) break
    place(next, { kind: w.kind as 'brief' | 'reference', by: 'torno', source: w.source })
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
