import type { BoardFile, PersonChange } from '../../../shared/board'
import { RULES_FRAME } from '../../../shared/brief'
import type { SizeFact } from '../../../shared/size'
import { boardActions, boardStore } from '../../state/board'

// What the person does on the brief page, asked of main as ordinary changes (`window.torno.board.change`). Main decides;
// a refusal is said on the page in its own words and nothing is kept of it. The cards have places in the file (the
// canvas's), which the page does not use: a new card goes below what is there, so that an old board that is read as a
// canvas somewhere else still has no two cards on one another.

const wordsOf = (error: unknown): string => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '') : String(error))

const current = (objectId: string): BoardFile | null => {
  const s = boardStore.getState()
  return s.objectId === objectId ? s.board : null
}

/** One change of main's: the board it answers with is the page's. Null when main refused it, with why said on the page. */
async function ask(objectId: string, change: PersonChange): Promise<BoardFile | null> {
  try {
    const next = await window.torno.board.change(objectId, change)
    boardActions.say(null)
    boardActions.setBoard(objectId, next)
    return next
  } catch (error) {
    boardActions.say(wordsOf(error))
    return null
  }
}

/** The place below every card of the board, in the width and height a new card of a kind is made at. */
export function placeBelow(board: BoardFile | null, size: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const bottom = (board?.cards ?? []).reduce((low, c) => Math.max(low, c.y + c.h), 0)
  return { x: 0, y: board === null || board.cards.length === 0 ? 0 : Math.round(bottom + 24), ...size }
}

const TEXT_SIZE = { w: 280, h: 160 }
const SIZE_CARD = { w: 240, h: 120 }
const PICTURE_SIZE = { w: 280, h: 210 }

/** A note: a text card of the person's. Whether main took it. */
export async function addNote(objectId: string, text: string): Promise<boolean> {
  const board = current(objectId)
  return (await ask(objectId, { op: 'add', card: { kind: 'text', text, ...placeBelow(board, TEXT_SIZE) } })) !== null
}

/** A rule: a text card in the frame named Rules, which is made (and holds the rules, as `briefOf` reads them) when the board has none. */
export async function addRule(objectId: string, text: string): Promise<boolean> {
  let board = current(objectId)
  if (board === null) return false
  let frame = board.cards.find((c) => c.kind === 'frame' && (c.name ?? '').trim().toLowerCase() === RULES_FRAME)?.id
  if (frame === undefined) {
    const was = new Set(board.cards.map((c) => c.id))
    board = await ask(objectId, { op: 'add', card: { kind: 'frame', name: 'Rules', ...placeBelow(board, { w: 320, h: 200 }) } })
    frame = board?.cards.find((c) => !was.has(c.id) && c.kind === 'frame')?.id
    if (board === null || frame === undefined) return false
  }
  return (await ask(objectId, { op: 'add', card: { kind: 'text', text, ...placeBelow(board, TEXT_SIZE), frame } })) !== null
}

export async function addSize(objectId: string, size: SizeFact): Promise<boolean> {
  return (await ask(objectId, { op: 'add', card: { kind: 'size', size, ...placeBelow(current(objectId), SIZE_CARD) } })) !== null
}

/** A picture the person gave: main keeps the file and names it, and a card holds the name. Pass a PNG or JPEG main takes (`prepareImage`). */
export async function addPicture(objectId: string, bytes: Uint8Array): Promise<boolean> {
  let picture: string
  try {
    picture = await window.torno.board.addPicture(objectId, bytes)
  } catch (error) {
    boardActions.say(wordsOf(error))
    return false
  }
  return (await ask(objectId, { op: 'add', card: { kind: 'picture', picture, ...placeBelow(current(objectId), PICTURE_SIZE) } })) !== null
}

/** A note, rule or size of Claude's made the person's own (#339): main keeps who wrote it. */
export async function adoptCard(objectId: string, id: string): Promise<boolean> {
  return (await ask(objectId, { op: 'adopt', id })) !== null
}

/** The words of a note or a rule, changed. */
export async function editText(objectId: string, id: string, text: string): Promise<boolean> {
  return (await ask(objectId, { op: 'edit', id, text })) !== null
}

export async function editSize(objectId: string, id: string, size: SizeFact): Promise<boolean> {
  return (await ask(objectId, { op: 'edit', id, size })) !== null
}

/** A caption on a picture, changed ('' takes it off). */
export async function editCaption(objectId: string, id: string, caption: string): Promise<boolean> {
  return (await ask(objectId, { op: 'edit', id, caption })) !== null
}

/** A card taken off (one that main made is only hidden). Whether main did it; `restore` brings it back by id. */
export async function removeCard(objectId: string, id: string): Promise<boolean> {
  return (await ask(objectId, { op: 'remove', ids: [id] })) !== null
}

/** Puts back what main took off in this run, by id. */
export async function restoreCard(objectId: string, id: string): Promise<boolean> {
  return (await ask(objectId, { op: 'restore', ids: [id] })) !== null
}

/** A card of main's own that was hidden (the brief, a photo) is shown again. */
export async function unhideCard(objectId: string, id: string): Promise<boolean> {
  return (await ask(objectId, { op: 'unhide', id })) !== null
}

/** Ties a size to a dimension with a tolerance, or (a null mark) takes the tie off: main sets the dimension's expected value and says why not when it cannot. Whether it did. */
export async function tieSize(objectId: string, id: string, mark: string | null, tolerance?: number): Promise<boolean> {
  try {
    const next = await window.torno.board.tie(objectId, id, mark, tolerance)
    boardActions.say(null)
    boardActions.setBoard(objectId, next)
    return true
  } catch (error) {
    boardActions.say(wordsOf(error))
    return false
  }
}
