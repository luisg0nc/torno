import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { BoardAttach, BoardFile } from '../../shared/board'
import { resetPictures } from './boardPictures'
import { windowStorage } from './column'
import { onWorkspaceSet, store } from './store'

/** The window's storage; none where there is no window (a test under node). */
const storageNow = (): Storage | null => (typeof window === 'undefined' ? null : windowStorage())

// The board of the open project in the window: what main last said of it, which of the two (the board or the model) the
// main area shows, and which cards are selected. The window keeps the choice of the two per project in its own storage
// (never in the workspace), and a project opens on the model until its board has a card of the person's or the agent's.

export type Shown = 'board' | 'model'

/** The tool in hand on the board: Select, or one that makes a text, a frame, an arrow, a size, a picture or a sketch. */
export type BoardTool = 'select' | 'text' | 'frame' | 'arrow' | 'size' | 'picture' | 'sketch'

/**
 * What is being written on the board in a field of its own, over the place it is for: the words of a text card (new, or
 * of one that is there), the facts of a size card (a form), the name of a frame being drawn or renamed, the word on an arrow. Board units throughout.
 */
export type Editing =
  | { kind: 'text'; x: number; y: number; w: number; h: number; id?: string }
  | { kind: 'frame'; x: number; y: number; w: number; h: number }
  /** A size card's form: over a new card's place, or over the card (`id`). */
  | { kind: 'size'; x: number; y: number; w: number; h: number; id?: string }
  | { kind: 'name'; id: string }
  | { kind: 'word'; id: string }

export interface BoardState {
  objectId: string | null
  /** As main last told it; null until it has, and for no project. */
  board: BoardFile | null
  shown: Shown
  /** Whether the person has chosen for this project (or an earlier visit did): the default no longer follows the board. */
  chosen: boolean
  /** Ids of the selected cards, frames and arrows. */
  selected: string[]
  tool: BoardTool
  editing: Editing | null
  /** What main refused of the last thing the person did, in its words; null when all is well. */
  problem: string | null
  /** What main found wrong with the board file when it read it (it could not be read, cards were left out), until it is dismissed. */
  fileProblem: string | null
  /** Whether a board has been read since the project opened: only the first decides what is shown, so that a card added meanwhile does not take the person from the model. */
  read: boolean
  /** What goes with the next prompt: the ids of cards and frames, or all the board. What each says is read when the prompt is sent. Null for none. */
  attached: BoardAttach | null
}

export const SHOWN_KEY = 'torno.board.shown'

type Reader = Pick<Storage, 'getItem'> | null
type Writer = Pick<Storage, 'getItem' | 'setItem'> | null

function readAll(storage: Reader): Record<string, unknown> {
  try {
    const kept: unknown = JSON.parse(storage?.getItem(SHOWN_KEY) ?? 'null')
    return typeof kept === 'object' && kept !== null && !Array.isArray(kept) ? (kept as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** What the person last chose for a project, or null when they did not, or the storage says something else. */
export function shownRead(storage: Reader, objectId: string): Shown | null {
  const kept = Object.hasOwn(readAll(storage), objectId) ? readAll(storage)[objectId] : null
  return kept === 'board' || kept === 'model' ? kept : null
}

export function shownWrite(storage: Writer, objectId: string, shown: Shown): void {
  try {
    storage?.setItem(SHOWN_KEY, JSON.stringify({ ...readAll(storage), [objectId]: shown }))
  } catch {
    // A storage that refuses: the window goes on as it is.
  }
}

/** The model, until the board has a card the person or the agent made: what main puts there by itself is no reason to show it. */
export function defaultShown(board: BoardFile | null): Shown {
  return board?.cards.some((c) => c.by !== 'torno' && !c.hidden) ? 'board' : 'model'
}

const NONE: BoardState = { objectId: null, board: null, shown: 'model', chosen: false, selected: [], tool: 'select', editing: null, problem: null, fileProblem: null, read: false, attached: null }

export const boardStore = createStore<BoardState>(() => NONE)

export const useBoard = <T>(select: (s: BoardState) => T): T => useZustand(boardStore, select)

/**
 * The board main just told, with each card and arrow that is as it was in `prev` kept as that very object: what comes
 * across the bridge is all new objects, and a card drawn again for being one is drawn again for nothing.
 */
export function sharing(prev: BoardFile | null, next: BoardFile): BoardFile {
  if (prev === null) return next
  const cards = new Map(prev.cards.map((c) => [c.id, c]))
  const arrows = new Map(prev.arrows.map((a) => [a.id, a]))
  const same = <T extends { id: string }>(was: T | undefined, now: T): T => (was !== undefined && JSON.stringify(was) === JSON.stringify(now) ? was : now)
  return { ...next, cards: next.cards.map((c) => same(cards.get(c.id), c)), arrows: next.arrows.map((a) => same(arrows.get(a.id), a)) }
}

const memories = new Set<() => void>()

/**
 * What the window keeps per project (the undo of the cards, where each camera was left) is named by a project's folder
 * name, which another workspace can reuse: it is let go when a workspace is opened or left. Whoever keeps such a thing asks
 * to be told here (`forgetMemories` is what does the telling).
 */
export function onBoardForgotten(cb: () => void): void {
  memories.add(cb)
}

/** Counts `forgetMemories`: what was begun before one is not kept after it. */
let forgotten = 0
export const memoryEpoch = (): number => forgotten

export function forgetMemories(): void {
  forgotten += 1
  for (const cb of memories) cb()
}

export const boardActions = {
  /** Nothing open: as at the start. */
  reset(): void {
    resetPictures(null)
    boardStore.setState(NONE, true)
  },

  /** A project is open: its choice of what to show, if it has one, and no board yet. */
  open(objectId: string | null, storage: Reader = storageNow()): void {
    resetPictures(objectId)
    if (objectId === null) return boardStore.setState(NONE, true)
    const kept = shownRead(storage, objectId)
    boardStore.setState({ ...NONE, objectId, shown: kept ?? 'model', chosen: kept !== null }, true)
  },

  /** Main's board of a project; one of a project that is not the open one is let go. */
  setBoard(objectId: string, board: BoardFile): void {
    const s = boardStore.getState()
    if (s.objectId !== objectId) return
    // Arrows take their ids from the same count as cards, and are selected as they are.
    const ids = new Set([...board.cards.map((c) => c.id), ...board.arrows.map((a) => a.id)])
    const selected = s.selected.filter((id) => ids.has(id))
    boardStore.setState({ board: sharing(s.board, board), read: true, shown: s.chosen || s.read ? s.shown : defaultShown(board), selected: selected.length === s.selected.length ? s.selected : selected })
  },

  /** Opens the project's board from main. A board that cannot be read leaves the window with none. */
  async load(objectId: string): Promise<void> {
    boardActions.open(objectId)
    try {
      boardActions.setBoard(objectId, await window.torno.board.read(objectId))
    } catch {
      // The board is left unread: the model is shown, and the next change main tells of tries again.
    }
    // What main found wrong with the file is told once, and this window may not have been listening.
    const problem = await window.torno.board.problem(objectId).catch(() => null)
    if (problem !== null) boardActions.setFileProblem({ objectId, message: problem })
  },

  show(which: Shown): void {
    const { objectId } = boardStore.getState()
    boardStore.setState({ shown: which, chosen: true })
    if (objectId !== null) shownWrite(storageNow(), objectId, which)
  },

  toggle(): void {
    boardActions.show(boardStore.getState().shown === 'board' ? 'model' : 'board')
  },

  select(ids: readonly string[], add = false): void {
    const s = boardStore.getState()
    const next = add ? [...s.selected, ...ids.filter((id) => !s.selected.includes(id))] : [...new Set(ids)]
    if (next.length === s.selected.length && next.every((id, i) => id === s.selected[i])) return
    boardStore.setState({ selected: next })
  },

  setTool(tool: BoardTool): void {
    if (boardStore.getState().tool !== tool) boardStore.setState({ tool })
  },

  edit(editing: Editing | null): void {
    boardStore.setState({ editing })
  },

  /** Main said what was wrong with a project's board file. It stays until it is dismissed or another project is opened. */
  setFileProblem(m: { objectId: string; message: string }): void {
    if (m.objectId === boardStore.getState().objectId) boardStore.setState({ fileProblem: m.message })
  },

  dismissFileProblem(): void {
    if (boardStore.getState().fileProblem !== null) boardStore.setState({ fileProblem: null })
  },

  say(problem: string | null): void {
    if (boardStore.getState().problem !== problem) boardStore.setState({ problem })
  },

  /** Puts the cards and frames selected with the next prompt (an arrow is no part of one). False when there are none. */
  attachSelected(): boolean {
    const { board, selected } = boardStore.getState()
    const ids = selected.filter((id) => board?.cards.some((c) => c.id === id && !c.hidden))
    if (ids.length === 0) return false
    boardStore.setState({ attached: { ids } })
    return true
  },

  /** Puts every card of the board with the next prompt. */
  attachAll(): void {
    boardStore.setState({ attached: { ids: 'all' } })
  },

  detach(): void {
    if (boardStore.getState().attached !== null) boardStore.setState({ attached: null })
  },

  /** What goes with the prompt being sent: taken out, for that prompt alone. */
  takeAttached(): BoardAttach | null {
    const { attached } = boardStore.getState()
    if (attached !== null) boardStore.setState({ attached: null })
    return attached
  },

  /** The prompt did not go: what was taken is put back, unless something else has been attached since. */
  giveBackAttached(attached: BoardAttach): void {
    if (boardStore.getState().attached === null) boardStore.setState({ attached })
  },

  /** Shows the board with that card, and only that card, selected: what a ref to it in the chat does. Nothing for a card the board has not (or has hidden). */
  reveal(id: string): void {
    const { board } = boardStore.getState()
    if (!board?.cards.some((c) => c.id === id && !c.hidden)) return
    boardActions.show('board')
    boardActions.select([id])
  }
}

/**
 * Joins the board to the open project and to main: it is read again whenever another project opens, and follows what main tells
 * of any board (the person's changes, the agent's, a pull). Returns what stops it.
 */
export function connectBoard(): () => void {
  const open = store.getState().objectId
  if (open !== null) void boardActions.load(open)
  const offStore = store.subscribe((s, prev) => {
    if (s.objectId !== prev.objectId) {
      if (s.objectId === null) boardActions.open(null)
      else void boardActions.load(s.objectId)
    }
  })
  const offWorkspace = onWorkspaceSet(forgetMemories)
  const offBoard = window.torno.board.onChanged((m) => boardActions.setBoard(m.objectId, m.board))
  const offProblem = window.torno.board.onProblem(boardActions.setFileProblem)
  return () => {
    offStore()
    offWorkspace()
    offBoard()
    offProblem()
  }
}
