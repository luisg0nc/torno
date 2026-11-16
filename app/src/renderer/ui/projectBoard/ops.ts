import type { BoardFile, Card, PersonChange } from '../../../shared/board'
import { boardActions, boardStore, onBoardForgotten } from '../../state/board'
import { cardsIn, frameAt } from './geometry'
import { BoardUndo, pick, withMembers } from './undo'

// What the person does to the board, asked of main as ordinary changes (`window.torno.board.change`): each is one
// action that the window can undo (`BoardUndo`). Main is the one that decides; a refusal is said on the board in its own
// words and nothing is kept of it.

const undos = new Map<string, BoardUndo>()
const undoOf = (objectId: string): BoardUndo => {
  let undo = undos.get(objectId)
  if (!undo) undos.set(objectId, (undo = new BoardUndo()))
  return undo
}

/** Forgets what could be undone: when another workspace is opened, a project of the same name is another project, and what was swept of the old one is gone. Under test too. */
export function forgetUndo(): void {
  undos.clear()
}
onBoardForgotten(forgetUndo)

const wordsOf = (error: unknown): string => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '') : String(error))

const current = (objectId: string): BoardFile | null => {
  const s = boardStore.getState()
  return s.objectId === objectId ? s.board : null
}

/**
 * One action: `send` asks main for one change or several, and the cards and arrows it touched (`ids`, the cards in the
 * frames among them, and what it added) are kept, before and after, for the undo. Null when main refused it.
 */
async function act(objectId: string, ids: readonly string[], send: () => Promise<BoardFile>): Promise<BoardFile | null> {
  const prev = current(objectId)
  if (!prev) return null
  const touched = withMembers(prev, ids)
  let next: BoardFile
  try {
    next = await send()
  } catch (error) {
    boardActions.say(wordsOf(error))
    return null
  }
  boardActions.say(null)
  boardActions.setBoard(objectId, next)
  const was = new Set([...prev.cards.map((c) => c.id), ...prev.arrows.map((a) => a.id)])
  const added = [...next.cards.map((c) => c.id), ...next.arrows.map((a) => a.id)].filter((id) => !was.has(id))
  undoOf(objectId).push(pick(prev, touched), pick(next, [...touched, ...added]))
  return next
}

const send = (objectId: string, change: PersonChange): Promise<BoardFile> => window.torno.board.change(objectId, change)

/** The id a change gave a card: the one that was not on the board before. */
function newId(prev: BoardFile, next: BoardFile, of: (c: Card) => boolean): string | undefined {
  const was = new Set(prev.cards.map((c) => c.id))
  return next.cards.find((c) => !was.has(c.id) && of(c))?.id
}

export type Made = { kind: 'text'; text: string } | { kind: 'picture' | 'sketch'; picture: string }

/** A new card of the person's at a place: it belongs to the frame its middle is in. */
export async function addCard(objectId: string, made: Made, rect: { x: number; y: number; w: number; h: number }): Promise<string | undefined> {
  const prev = current(objectId)
  if (!prev) return undefined
  const frame = frameAt(prev.cards, rect)
  const next = await act(objectId, [], () => send(objectId, { op: 'add', card: { ...made, ...rect, ...(frame === null ? {} : { frame }) } }))
  return next ? newId(prev, next, (c) => c.kind === made.kind) : undefined
}

/** A picture (or a sketch) the person gave: main keeps the file and names it, and a card holds the name. */
export async function addPictureCard(objectId: string, bytes: Uint8Array, kind: 'picture' | 'sketch', rect: { x: number; y: number; w: number; h: number }): Promise<void> {
  let picture: string
  try {
    picture = await window.torno.board.addPicture(objectId, bytes)
  } catch (error) {
    boardActions.say(wordsOf(error))
    throw error
  }
  await addCard(objectId, { kind, picture }, rect)
}

/** A sketch drawn on again: main keeps the new drawing and the card shows it. One action, which can be undone. Rejects, the card unchanged, with why not. */
export async function redrawSketch(objectId: string, id: string, bytes: Uint8Array): Promise<void> {
  let picture: string
  try {
    picture = await window.torno.board.addPicture(objectId, bytes)
  } catch (error) {
    boardActions.say(wordsOf(error))
    throw error
  }
  const next = await act(objectId, [id], () => send(objectId, { op: 'edit', id, picture }))
  if (next === null) throw new Error(boardStore.getState().problem ?? 'The sketch could not be changed.')
}

/** A frame drawn at `rect`, named: the cards whose middles are inside it join it. Nothing is made for an empty name. */
export async function addFrame(objectId: string, rect: { x: number; y: number; w: number; h: number }, name: string): Promise<void> {
  const prev = current(objectId)
  const words = name.trim()
  if (!prev || words === '') return
  const inside = cardsIn(prev.cards, rect)
  await act(objectId, inside, async () => {
    const made = await send(objectId, { op: 'add', card: { kind: 'frame', ...rect, name: words } })
    const id = newId(prev, made, (c) => c.kind === 'frame')
    if (!id || inside.length === 0) return made
    return send(objectId, { op: 'move', moves: inside.map((cardId) => ({ id: cardId, ...place(prev, cardId), frame: id })) })
  })
}

const place = (board: BoardFile, id: string): { x: number; y: number } => {
  const c = board.cards.find((card) => card.id === id)!
  return { x: c.x, y: c.y }
}

export interface Move {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  frame?: string | null
}

/** Cards moved or resized. Whatever is in a frame that is moved goes with it (main does that). Whether it was done. */
export async function moveCards(objectId: string, moves: Move[]): Promise<boolean> {
  if (moves.length === 0) return true
  return (await act(objectId, moves.map((m) => m.id), () => send(objectId, { op: 'move', moves }))) !== null
}

/** The words of a card, the name of a frame, or the caption of a picture, changed. */
export async function editCard(objectId: string, id: string, fields: { text?: string; name?: string; caption?: string }): Promise<void> {
  await act(objectId, [id], () => send(objectId, { op: 'edit', id, ...fields }))
}

/** Cards removed (those that appeared by themselves are hidden), and arrows taken off. */
export async function removeThings(objectId: string, ids: readonly string[]): Promise<void> {
  const board = current(objectId)
  if (!board || ids.length === 0) return
  const arrows = ids.filter((id) => board.arrows.some((a) => a.id === id))
  const cards = ids.filter((id) => board.cards.some((c) => c.id === id))
  await act(objectId, ids, async () => {
    let now = board
    for (const id of arrows) now = await send(objectId, { op: 'unarrow', id })
    if (cards.length > 0) now = await send(objectId, { op: 'remove', ids: cards })
    return now
  })
}

/** A card that was hidden is shown again where it was. */
export async function showAgain(objectId: string, id: string): Promise<void> {
  await act(objectId, [id], () => send(objectId, { op: 'unhide', id }))
}

export async function drawArrow(objectId: string, from: string, to: string): Promise<void> {
  await act(objectId, [], () => send(objectId, { op: 'arrow', from, to }))
}

/** The word on an arrow, changed: main has no change for it, so the arrow is drawn again with the word (one action, one undo). */
export async function wordArrow(objectId: string, id: string, label: string): Promise<void> {
  const arrow = current(objectId)?.arrows.find((a) => a.id === id)
  if (!arrow || (arrow.label ?? '') === label) return
  await act(objectId, [id], async () => {
    await send(objectId, { op: 'unarrow', id })
    return send(objectId, { op: 'arrow', from: arrow.from, to: arrow.to, ...(label === '' ? {} : { label }) })
  })
}

/** Takes back the last thing done here: one action, which can be more than one change of main's. */
export async function undo(objectId: string): Promise<void> {
  const stack = undoOf(objectId)
  for (let change = stack.undo(); change; change = stack.chained ? stack.undo() : null) {
    try {
      boardActions.setBoard(objectId, await send(objectId, change))
      boardActions.say(null)
    } catch (error) {
      boardActions.say(wordsOf(error))
      return
    }
  }
}
