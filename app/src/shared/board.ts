import type { SizeFact, SizeUnit } from './size'
import type { Camera as SavedCamera } from './view'

// The board of a project (`<project>/.torno/board/board.json`): cards laid out on a canvas, frames that hold
// cards, and arrows between them. Main is the only writer (`main/board/store.ts`); the window and the agent's
// tools ask it for changes.

export type { SavedCamera }

export type CardKind = 'brief' | 'reference' | 'mark' | 'scan' | 'build' | 'view' | 'params' | 'checks' | 'text' | 'picture' | 'sketch' | 'frame' | 'size'

/** Cards that appear by themselves, from what the project has. */
export const AUTO_KINDS: readonly CardKind[] = ['brief', 'reference', 'mark', 'scan']
/** Cards the person pins from the build strip, the views, the Params and the checks. */
export const PINNED_KINDS: readonly CardKind[] = ['build', 'view', 'params', 'checks']
/** Cards the person makes on the board, and the agent may too (a text, a picture, a frame, a size). */
export const MADE_KINDS: readonly CardKind[] = ['text', 'picture', 'sketch', 'frame', 'size']

/** What a build card keeps of the build it shows, so it can say so when the build is not on this computer. */
export interface BuildCopy {
  id: string
  line: string
  cause: string
  /** The build's `sources` hash: a local build of the same id with another hash is not the same build. */
  sources: string
}

export interface Card {
  /** `C<n>`, given by main. */
  id: string
  kind: CardKind
  x: number
  y: number
  w: number
  h: number
  /** Whose it is: the person's, the agent's, or main's own (a card that appeared by itself). */
  by: 'person' | 'agent' | 'torno'
  /** The id of the frame it is in. */
  frame?: string
  /** What it shows: `brief`, a `reference/` path, `M<n>`, `S<n>`, `h<n>`, a view's name, `params` or `checks`. */
  source?: string
  layout?: string
  text?: string
  name?: string
  /** A file name in `pictures/`. */
  picture?: string
  caption?: string
  camera?: SavedCamera
  /** Only ever true, and only on a card of main's own: removing one hides it. */
  hidden?: true
  copy?: BuildCopy
  /** What a `size` card says: only ever on that kind. */
  size?: SizeFact
}

export interface Arrow {
  /** `C<n>`: arrows take their ids from the same count as cards. */
  id: string
  from: string
  to: string
  label?: string
  by: 'person' | 'agent'
}

export interface BoardFile {
  next: number
  cards: Card[]
  arrows: Arrow[]
}

/** An id of a card, a frame or an arrow. */
export const CARD_ID = /^C[1-9]\d*$/
/** The name of a picture's file in `pictures/`. */
export const PICTURE_NAME = /^p-[0-9a-f]{12}\.(png|jpg)$/

/** The most characters an attachment holds. */
export const MAX_ATTACH_CHARS = 12_000
/** The most pictures an attachment holds. */
export const MAX_BOARD_PICTURES = 6
/** The longest edge of a picture sent with a prompt. */
export const BOARD_PICTURE_EDGE = 1280
export const MAX_CARDS = 2000
export const MAX_TEXT_CHARS = 4000
/** The longest name of a frame, caption or word on an arrow. */
export const MAX_NAME_CHARS = 200

/** What the window may ask of the board. Never an id, an author or `hidden`: those are main's. */
export type PersonChange =
  | { op: 'add'; card: Omit<Card, 'id' | 'by' | 'hidden'> }
  | { op: 'move'; moves: Array<{ id: string; x: number; y: number; w?: number; h?: number; frame?: string | null }> }
  | { op: 'edit'; id: string; text?: string; name?: string; caption?: string; picture?: string; size?: SizeFact }
  | { op: 'remove'; ids: string[] }
  | { op: 'unhide'; id: string }
  | { op: 'arrow'; from: string; to: string; label?: string }
  | { op: 'unarrow'; id: string }
  /** Puts back cards and arrows main removed in this run, by id: what they were is main's to say, never the window's. */
  | { op: 'restore'; ids: string[] }

/**
 * What the agent's tools may ask of the board (`add_card`). It only ever adds cards of its own and changes or removes
 * those: never an id, an author, a place or a size, and never a card of the person's or of main's own.
 */
export type AgentChange =
  | { op: 'add'; text?: string; picture?: string; camera?: SavedCamera; size?: { what: string; value: string; unit?: SizeUnit; note?: string }; frame?: string; arrow?: { from?: string; to?: string; label?: string } }
  | { op: 'edit'; id: string; text: string }
  | { op: 'remove'; id: string }

/** What the window pins from what the project has: the build by its id in the history, a view by its name, the Params, the checks. */
export type PinWhat = { kind: 'build'; id: string } | { kind: 'view'; name: string } | { kind: 'params' } | { kind: 'checks' }

/** What the window asks main to open from a card: the brief in the person's program, or a file of `reference/` in its folder. */
export type BoardOpen = { kind: 'brief' } | { kind: 'reference'; file: string }

/** Which part of the board goes with a prompt: the cards and frames named by id, or all of it. Read when the prompt is sent. */
export interface BoardAttach {
  ids: string[] | 'all'
}

/** What went with a prompt, as text only: the cards (not frames) and arrows told, the names of the frames, and the ids that were gone by then. */
export interface BoardSent {
  cards: number
  arrows: number
  frames: string[]
  gone?: string[]
}

/** What the board line of a prompt said: how many cards the board had, and how many of them were new to the agent. */
export interface BoardCounts {
  total: number
  new: number
}

/** What went with a prompt, as the pieces a line is made of: the frames by name, then the cards and the arrows ("Latch", "3 cards", "1 arrow"). */
function sentParts(sent: Pick<BoardSent, 'cards' | 'arrows' | 'frames'>): string[] {
  const many = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
  return [...sent.frames, ...(sent.cards > 0 || sent.frames.length === 0 ? [many(sent.cards, 'card')] : []), ...(sent.arrows > 0 ? [many(sent.arrows, 'arrow')] : [])]
}

/** What went with a prompt, in a line: the frames by name, then the cards and the arrows ("Latch, 3 cards, 1 arrow"). */
export function sentLine(sent: BoardSent): string {
  return sentParts(sent).join(', ')
}

/** What the person has chosen to send of the board, as the board is now: the same counts the prompt will tell, and the ids that are no longer there. */
export interface AttachSummary extends Pick<BoardSent, 'cards' | 'arrows' | 'frames'> {
  gone: string[]
}

/**
 * What `ids` (cards and frames, or all of the board) come to on `board` as main will read them when the prompt is sent
 * (`boardText`): the cards that are shown and are named or are in a frame that is, the arrows between them, the frames by name.
 * An id that is an arrow is no part of an attachment and is left out without a word; one that is no card or is hidden is `gone`.
 */
export function attachSummary(board: BoardFile, ids: readonly string[] | 'all'): AttachSummary {
  const shown = board.cards.filter((c) => !c.hidden)
  const named = ids === 'all' ? null : new Set(ids)
  const taken = shown.filter((c) => named === null || named.has(c.id) || (c.frame !== undefined && named.has(c.frame)))
  const here = new Set(taken.map((c) => c.id))
  const known = new Set([...shown.map((c) => c.id), ...board.arrows.map((a) => a.id)])
  return {
    cards: taken.filter((c) => c.kind !== 'frame').length,
    arrows: board.arrows.filter((a) => here.has(a.from) && here.has(a.to)).length,
    frames: taken.filter((c) => c.kind === 'frame').map((c) => c.name || c.id),
    gone: ids === 'all' ? [] : [...new Set(ids)].filter((id) => !known.has(id))
  }
}

/** The chip in the composer: "Latch · 3 cards · 1 arrow". */
export function attachLabel(sum: Pick<AttachSummary, 'cards' | 'arrows' | 'frames'>): string {
  return sentParts(sum).join(' · ')
}

/** The first words of the text block an attachment is told in: main's own, so the chat's prompt shows the person's words and not this. */
export const ATTACHMENT_HEAD = 'Attached from the board by the person'

export const emptyBoard = (): BoardFile => ({ next: 1, cards: [], arrows: [] })

/** Left to right within a row; rows top to bottom; ties by id so the order never wavers. */
function inRows(cards: readonly Card[]): Card[] {
  const number = (c: Card): number => Number(c.id.slice(1))
  const byTop = [...cards].sort((a, b) => a.y - b.y || a.x - b.x || number(a) - number(b))
  const rows: Card[][] = []
  for (const card of byTop) {
    // A row is held by its first (highest) card: one whose top is within half the taller of the two is in it.
    const row = rows.find((r) => card.y - r[0].y <= Math.max(card.h, r[0].h) / 2)
    if (row) row.push(card)
    else rows.push([card])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || number(a) - number(b)))
}

/**
 * The cards of a board as a person reads them: each frame by its position, followed by its cards, then the cards
 * in no frame. Cards whose tops are within half the taller card's height are one row, left to right; rows go top
 * to bottom. A hidden card is left out.
 */
export function readingOrder(cards: readonly Card[]): Card[] {
  const shown = cards.filter((c) => !c.hidden)
  const frames = inRows(shown.filter((c) => c.kind === 'frame'))
  const members = (frame: Card): Card[] => inRows(shown.filter((c) => c.kind !== 'frame' && c.frame === frame.id))
  const inFrame = new Set(frames.flatMap((f) => members(f).map((c) => c.id)))
  const loose = inRows(shown.filter((c) => c.kind !== 'frame' && !inFrame.has(c.id)))
  return [...frames.flatMap((f) => [f, ...members(f)]), ...loose]
}
